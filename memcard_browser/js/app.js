import { SnapshotHistory } from "./app-history.js";
import {
  collectDroppedItems,
  isFileDragEvent,
  readFileAsArrayBuffer,
  sanitizeDownloadName,
  sanitizeImportedName,
  triggerDownload,
  uniqueName,
} from "./app-utils.js";
import {
  buildCardIndex,
  buildGlobalSearchEntries,
  summarizeIndexChanges,
} from "./card-index.js";
import { FAT } from "./constants.js";
import { Ps2MemoryCardEditor } from "./ps2mc-editor.js";
import { createEmptyPs2CardImage } from "./ps2mc-newcard.js";
import { BrowserUI } from "./ui.js";
import { createZipBlob, readZipEntries } from "./zip-utils.js";

const ui = new BrowserUI();
const imageInput = document.getElementById("imageInput");
const addFileInput = document.getElementById("addFileInput");
const importZipInput = document.getElementById("importZipInput");
const importZipButton = document.getElementById("importZipButton");
const dropZone = document.getElementById("dropZone");
const createEmptyCardButton = document.getElementById("createEmptyCardButton");
const newCardSizeSelect = document.getElementById("newCardSizeSelect");
const tableWrap = document.querySelector(".table-wrap");
const contextMenu = document.getElementById("contextMenu");

const state = {
  editor: null,
  parser: null,
  loadedFileName: "",
  dirStack: [],
  rawEntries: [],
  entries: [],
  selectedIndex: -1,
  selectedEntry: null,
  tableDragDepth: 0,
  searchQuery: "",
  searchGlobal: false,
  baseIndex: null,
  currentIndex: null,
  integrityReport: null,
};

function currentDir() {
  return state.dirStack[state.dirStack.length - 1] || null;
}

function isRootDir() {
  const dir = currentDir();
  if (!dir || !state.parser) return false;
  return dir.clusterRel === state.parser.superblock.rootDirCluster;
}

function syncParserFromEditor() {
  state.parser = state.editor ? state.editor.getParser() : null;
}

function canMutateCard() {
  return Boolean(state.editor && state.editor.canMutate());
}

function canAddFolderHere() {
  return canMutateCard() && isRootDir();
}

function showError(err, fallbackText) {
  ui.setStatus((err && err.message) || fallbackText, true);
}

function closeContextMenu() {
  contextMenu.hidden = true;
  contextMenu.innerHTML = "";
  contextMenu.style.left = "-9999px";
  contextMenu.style.top = "-9999px";
}

function openContextMenu(x, y, items) {
  contextMenu.innerHTML = "";
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    if (item.danger) button.classList.add("danger");
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => {
      closeContextMenu();
      if (!item.disabled) item.run();
    });
    contextMenu.appendChild(button);
  }

  contextMenu.hidden = false;
  const padding = 8;
  const rect = contextMenu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width + padding > window.innerWidth) {
    left = Math.max(padding, window.innerWidth - rect.width - padding);
  }
  if (top + rect.height + padding > window.innerHeight) {
    top = Math.max(padding, window.innerHeight - rect.height - padding);
  }
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

function clearTableDropHighlight() {
  state.tableDragDepth = 0;
  tableWrap.classList.remove("file-drop-active");
}

function ensureWritableCard() {
  if (!state.editor || !state.parser) {
    throw new Error("No memory card image loaded.");
  }
  if (!canMutateCard()) {
    throw new Error("This card is not writable.");
  }
}

function updatePathDisplay() {
  const parts = state.dirStack.map((x) => x.name).filter(Boolean);
  ui.setPath("/" + parts.join("/"));
  ui.setUpEnabled(state.dirStack.length > 1);
}

function historyCapacity() {
  if (!state.editor) return 2;
  const size = Math.max(1, state.editor.getImageSize());
  const budget = 192 * 1024 * 1024;
  return Math.max(2, Math.min(40, Math.floor(budget / size)));
}

const history = new SnapshotHistory(historyCapacity);

function updateChangeSummary() {
  if (!state.parser || !state.baseIndex) {
    ui.renderChangeSummary("No pending changes.");
    ui.setUndoRedoEnabled(false, false);
    return;
  }

  state.currentIndex = buildCardIndex(state.parser);
  const { addedFiles, removedFiles, addedDirs, removedDirs, usedDelta } =
    summarizeIndexChanges(state.baseIndex, state.currentIndex);
  const pendingLabels = history.getPendingLabels();
  const recent = pendingLabels.slice(-6);
  const lines = [
    `Pending Actions: ${pendingLabels.length}`,
    `Files +${addedFiles} / -${removedFiles}`,
    `Folders +${addedDirs} / -${removedDirs}`,
    `Used Bytes Delta: ${usedDelta >= 0 ? "+" : ""}${usedDelta}`,
    pendingLabels.length > 0 ? `Recent: ${recent.join(" | ")}` : "Recent: none",
  ];
  ui.renderChangeSummary(lines.join("\n"));
  ui.setUndoRedoEnabled(history.canUndo(), history.canRedo());
}

function renderIntegritySummary(report) {
  if (!report) {
    ui.renderIntegritySummary("Integrity check not run.");
    ui.setIntegrityActionsEnabled(Boolean(state.editor), false);
    return;
  }
  const lines = [
    `Issues: ${report.summary.totalIssues}`,
    `Orphan Clusters: ${report.summary.orphanClusters}`,
    `Length Fixes: ${report.summary.lengthFixes}`,
  ];
  for (const finding of report.findings.slice(0, 6)) {
    lines.push(`- ${finding.type}: ${finding.path}`);
  }
  if (report.findings.length > 6) {
    lines.push(`... ${report.findings.length - 6} more`);
  }
  ui.renderIntegritySummary(lines.join("\n"));
  const canRepair = (report.repairPlan.orphanClusters.length +
    report.repairPlan.lengthFixes.length) > 0;
  ui.setIntegrityActionsEnabled(Boolean(state.editor), canRepair);
}

function applySearch(entries) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return entries;
  if (!state.searchGlobal) {
    return entries.filter((entry) =>
      String(entry.name || "").toLowerCase().includes(query)
    );
  }
  return buildGlobalSearchEntries(state.currentIndex, query);
}

function updateEntryActionButtons(entry) {
  const canDelete = Boolean(
    entry && !entry.isParentNav &&
      (entry.type === "file" || entry.type === "directory"),
  );
  const canDownload = Boolean(entry && entry.type === "file");
  const canRename = canDelete;
  const canExportFolder = Boolean(entry && entry.type === "directory");
  ui.setDownloadEnabled(canDownload);
  ui.setDeleteEnabled(canDelete);
  ui.setRenameEnabled(canRename);
  ui.setExportFolderEnabled(canExportFolder);
}

function renderEntries() {
  const filtered = applySearch(state.rawEntries);
  state.entries = filtered;
  state.selectedIndex = -1;
  state.selectedEntry = null;
  ui.renderEntries(
    state.entries,
    state.selectedIndex,
    handleRowClick,
    handleRowDoubleClick,
    handleRowContext,
  );
  updateEntryActionButtons(null);
  if (state.entries.length === 0) {
    const searchText = state.searchQuery.trim();
    ui.renderEntryDetails(
      null,
      searchText ? `No entries matching "${searchText}".` : "",
    );
  } else {
    ui.renderEntryDetails(null);
  }
}

function refreshDirectoryView() {
  closeContextMenu();
  const dir = currentDir();
  if (!dir || !state.parser) return;

  let parsedEntries = [];
  try {
    parsedEntries = state.parser.parseDirectory(dir.clusterRel, false);
  } catch (err) {
    showError(err, "Failed to read directory.");
  }
  const navEntries = state.dirStack.length > 1
    ? [{
      name: "..",
      type: "parent",
      mode: 0,
      length: 0,
      clusterRel: FAT.END_OF_CHAIN,
      entryIndex: 0,
      attr: 0,
      created: null,
      modified: null,
      isParentNav: true,
    }]
    : [];

  state.rawEntries = navEntries.concat(parsedEntries);
  updateChangeSummary();
  renderEntries();
  updatePathDisplay();
}

function toEntryExtraText(entry) {
  if (!entry) return "";
  const lines = [];
  if (entry.isSearchResult) {
    lines.push(`Path: ${entry.path || entry.name}`);
  }
  if (entry.type === "file") {
    try {
      const data = state.parser.readFileData(entry);
      const preview = ui.renderFilePreview(data, 14);
      lines.push("Raw Preview (hex + ASCII):");
      lines.push(preview);
    } catch (err) {
      lines.push(`Could not read file data: ${err.message}`);
    }
  }
  return lines.join("\n");
}

function openSearchResult(entry) {
  if (!entry || !entry.isSearchResult) return;
  state.searchGlobal = false;
  state.searchQuery = "";
  ui.searchGlobalCheckbox.checked = false;
  ui.searchInput.value = "";
  state.dirStack = entry.parentStack.map((x) => ({
    name: x.name,
    clusterRel: x.clusterRel,
  }));
  refreshDirectoryView();
  const idx = state.rawEntries.findIndex((x) =>
    x.name === entry.targetName && x.slotIndex === entry.slotIndex
  );
  if (idx >= 0) {
    handleRowClick(idx);
    if (entry.type === "directory") {
      handleRowDoubleClick(idx);
    }
  }
}

function handleRowClick(index) {
  state.selectedIndex = index;
  const entry = state.entries[index];
  state.selectedEntry = entry || null;
  ui.renderEntries(
    state.entries,
    state.selectedIndex,
    handleRowClick,
    handleRowDoubleClick,
    handleRowContext,
  );
  updateEntryActionButtons(entry);

  if (entry && entry.isParentNav) {
    ui.renderEntryDetails({
      name: "..",
      type: "parent",
      mode: 0,
      length: 0,
      clusterRel: FAT.END_OF_CHAIN,
      entryIndex: 0,
      attr: 0,
      created: null,
      modified: null,
    }, "Open parent directory.");
    return;
  }
  ui.renderEntryDetails(entry, toEntryExtraText(entry));
}

function goUp() {
  if (state.dirStack.length <= 1) return;
  state.dirStack.pop();
  refreshDirectoryView();
}

function openDirectoryEntry(entry) {
  if (!entry || entry.type !== "directory") return;
  state.dirStack.push({
    name: entry.name,
    clusterRel: entry.clusterRel,
  });
  refreshDirectoryView();
}

function handleRowDoubleClick(index) {
  const entry = state.entries[index];
  if (!entry) return;
  if (entry.isParentNav) {
    goUp();
    return;
  }
  if (entry.isSearchResult) {
    openSearchResult(entry);
    return;
  }
  if (entry.type === "directory") {
    openDirectoryEntry(entry);
  } else {
    handleRowClick(index);
  }
}

function getEntryParentCluster(entry) {
  if (!entry) return null;
  if (entry.isSearchResult) return entry.parentClusterRel;
  const dir = currentDir();
  return dir ? dir.clusterRel : null;
}

function runMutation(label, fn) {
  ensureWritableCard();
  const before = state.editor.getArrayBufferCopy();
  try {
    fn();
  } catch (err) {
    state.editor.loadFromArrayBuffer(before);
    syncParserFromEditor();
    throw err;
  }
  syncParserFromEditor();
  history.record(label, before);
  state.integrityReport = null;
  renderIntegritySummary(null);
}

function undoLast() {
  if (!state.editor || !history.canUndo()) return;
  const current = state.editor.getArrayBufferCopy();
  const previous = history.undo(current);
  if (!previous) return;
  state.editor.loadFromArrayBuffer(previous);
  syncParserFromEditor();
  refreshDirectoryView();
}

function redoLast() {
  if (!state.editor || !history.canRedo()) return;
  const current = state.editor.getArrayBufferCopy();
  const next = history.redo(current);
  if (!next) return;
  state.editor.loadFromArrayBuffer(next);
  syncParserFromEditor();
  refreshDirectoryView();
}

function downloadSelectedFile() {
  const entry = state.selectedEntry;
  if (!state.parser || !entry || entry.type !== "file") return;
  try {
    const data = state.parser.readFileData(entry);
    triggerDownload(
      new Blob([data], { type: "application/octet-stream" }),
      sanitizeDownloadName(entry.name),
    );
    ui.setStatus(`Downloaded ${entry.name}`);
  } catch (err) {
    showError(err, "Could not download selected file.");
  }
}

function downloadCurrentImage() {
  if (!state.editor) return;
  try {
    const fileName = sanitizeDownloadName(
      state.loadedFileName || "memory-card.mcd",
    );
    triggerDownload(state.editor.getImageBlob(), fileName);
    ui.setStatus(`Downloaded image ${fileName}`);
  } catch (err) {
    showError(err, "Could not download image.");
  }
}

async function exportSelectedFolderZip() {
  const entry = state.selectedEntry;
  if (!state.parser || !entry || entry.type !== "directory") return;

  try {
    const queue = [{ clusterRel: entry.clusterRel, prefix: `${entry.name}/` }];
    const seen = new Set();
    const zipEntries = [{ path: `${entry.name}/`, isDirectory: true }];

    while (queue.length > 0) {
      const cur = queue.shift();
      if (seen.has(cur.clusterRel)) continue;
      seen.add(cur.clusterRel);
      const children = state.parser.parseDirectory(cur.clusterRel, false);
      for (const child of children) {
        if (child.type === "directory") {
          const dirPath = `${cur.prefix}${child.name}/`;
          zipEntries.push({ path: dirPath, isDirectory: true });
          queue.push({ clusterRel: child.clusterRel, prefix: dirPath });
        } else if (child.type === "file") {
          const filePath = `${cur.prefix}${child.name}`;
          const data = state.parser.readFileData(child);
          zipEntries.push({ path: filePath, isDirectory: false, data });
        }
      }
    }

    triggerDownload(
      createZipBlob(zipEntries),
      sanitizeDownloadName(`${entry.name}.zip`),
    );
    ui.setStatus(`Exported folder ${entry.name} as ZIP`);
  } catch (err) {
    showError(err, "Could not export folder ZIP.");
  }
}

function promptRenameEntry() {
  const entry = state.selectedEntry;
  if (!entry || entry.isParentNav) return;
  const newName = window.prompt(
    "New name:",
    entry.isSearchResult ? entry.targetName || entry.name : entry.name,
  );
  if (newName === null) return;
  const parentCluster = getEntryParentCluster(entry);
  if (!Number.isFinite(parentCluster)) return;
  try {
    runMutation(`Rename ${entry.name}`, () => {
      state.editor.renameEntry(parentCluster, entry, newName);
    });
    refreshDirectoryView();
    ui.setStatus(`Renamed to ${newName.trim()}`);
  } catch (err) {
    showError(err, "Could not rename entry.");
  }
}

function deleteSelectedEntry() {
  const entry = state.selectedEntry;
  if (!entry || entry.isParentNav) return;
  const promptText = entry.type === "directory"
    ? `Delete folder "${entry.name}" and all its contents recursively?`
    : `Delete file "${entry.name}"?`;
  if (!window.confirm(promptText)) return;

  const parentCluster = getEntryParentCluster(entry);
  if (!Number.isFinite(parentCluster)) return;

  try {
    runMutation(`Delete ${entry.name}`, () => {
      state.editor.deleteEntry(parentCluster, entry);
    });
    refreshDirectoryView();
    ui.setStatus(`Deleted ${entry.name}`);
  } catch (err) {
    showError(err, "Could not delete entry.");
  }
}

async function addFilesToDirectory(
  targetDirRel,
  sourceItems,
  labelPrefix = "Add files",
) {
  const items = Array.from(sourceItems || []).filter((x) =>
    x && (x.file || x.bytes)
  );
  if (items.length === 0) return;

  ensureWritableCard();
  const existing = state.parser.parseDirectory(targetDirRel, false).map((e) =>
    e.name
  );
  const usedNames = new Set(existing);
  const before = state.editor.getArrayBufferCopy();

  let added = 0;
  let failed = 0;
  let flattened = 0;
  for (const item of items) {
    try {
      const rel = String(
        item.relativePath || (item.file && item.file.name) || item.name ||
          "file.bin",
      );
      if (rel.includes("/")) flattened += 1;
      const safeBase = sanitizeImportedName(rel.replace(/\//g, "_"));
      const finalName = uniqueName(safeBase, usedNames);
      const data = item.bytes instanceof Uint8Array
        ? item.bytes
        : new Uint8Array(await readFileAsArrayBuffer(item.file));
      state.editor.addFile(targetDirRel, finalName, data);
      added += 1;
    } catch (_) {
      failed += 1;
    }
  }

  if (added > 0) {
    syncParserFromEditor();
    history.record(`${labelPrefix} (${added})`, before);
    state.integrityReport = null;
    renderIntegritySummary(null);
    refreshDirectoryView();
    const warn = [];
    if (flattened > 0) warn.push(`${flattened} paths flattened`);
    if (failed > 0) warn.push(`${failed} failed`);
    const suffix = warn.length > 0 ? ` (${warn.join(", ")})` : "";
    ui.setStatus(
      `Added ${added} file${added === 1 ? "" : "s"}${suffix}.`,
      failed > 0,
    );
  } else {
    ui.setStatus(`No files added (${failed} failed).`, true);
  }
}

async function addExternalFilesToCurrentDir(items) {
  const dir = currentDir();
  if (!dir) throw new Error("No current directory.");
  await addFilesToDirectory(dir.clusterRel, items, "Add files");
}

function addFolderToCurrentDir() {
  const requestedName = window.prompt("Folder name (ASCII, max 31 chars):");
  if (requestedName === null) return;

  try {
    ensureWritableCard();
    if (!isRootDir()) {
      throw new Error(
        "Nested folders are not allowed. Create folders only in root.",
      );
    }
    const dir = currentDir();
    if (!dir) throw new Error("No current directory selected.");

    runMutation(`Add folder ${requestedName.trim()}`, () => {
      state.editor.addDirectory(dir.clusterRel, requestedName);
    });
    refreshDirectoryView();
    ui.setStatus(`Added folder ${requestedName.trim()}`);
  } catch (err) {
    showError(err, "Could not add folder.");
  }
}

function normalizeZipPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function ensureRootDirectoryForImport(rootCluster, rawName) {
  const safeName = sanitizeImportedName(rawName);
  let rootEntries = state.parser.parseDirectory(rootCluster, false);

  const existingDir = rootEntries.find((entry) =>
    entry.type === "directory" && entry.name === safeName
  );
  if (existingDir) {
    return { clusterRel: existingDir.clusterRel, name: safeName };
  }

  const existingFile = rootEntries.find((entry) =>
    entry.type === "file" && entry.name === safeName
  );
  if (existingFile) {
    throw new Error(
      `Cannot create folder "${safeName}" because a file with that name already exists in root.`,
    );
  }

  runMutation(`Add folder ${safeName}`, () => {
    state.editor.addDirectory(rootCluster, safeName);
  });
  rootEntries = state.parser.parseDirectory(rootCluster, false);
  const created = rootEntries.find((entry) =>
    entry.type === "directory" && entry.name === safeName
  );
  if (!created) {
    throw new Error(`Could not create folder "${safeName}" during ZIP import.`);
  }
  return { clusterRel: created.clusterRel, name: safeName };
}

async function importZipToRoot(zipFile) {
  if (!zipFile) return;
  try {
    ensureWritableCard();
    const rootCluster = state.parser.superblock.rootDirCluster;
    const buffer = await readFileAsArrayBuffer(zipFile);
    const entries = await readZipEntries(buffer);
    const fileEntries = entries.filter((entry) => !entry.isDirectory);
    if (fileEntries.length === 0) {
      ui.setStatus("ZIP contains no files to import.", true);
      return;
    }

    const rootItems = [];
    const byRootFolder = new Map();
    let flattenedNestedPaths = 0;
    for (const entry of fileEntries) {
      const normalized = normalizeZipPath(entry.path);
      if (!normalized) continue;
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0) continue;
      if (parts.length === 1) {
        rootItems.push({
          bytes: entry.data,
          relativePath: parts[0],
        });
        continue;
      }

      const rootName = parts[0];
      const nestedName = parts.slice(1).join("_");
      if (!nestedName) continue;
      if (parts.length > 2) flattenedNestedPaths += 1;
      if (!byRootFolder.has(rootName)) {
        byRootFolder.set(rootName, []);
      }
      byRootFolder.get(rootName).push({
        bytes: entry.data,
        relativePath: nestedName,
      });
    }

    if (rootItems.length > 0) {
      await addFilesToDirectory(rootCluster, rootItems, "Import ZIP");
    }
    for (const [rawRootName, items] of byRootFolder) {
      const dir = ensureRootDirectoryForImport(rootCluster, rawRootName);
      await addFilesToDirectory(
        dir.clusterRel,
        items,
        `Import ZIP ${dir.name}`,
      );
    }

    const suffix = flattenedNestedPaths > 0
      ? ` (${flattenedNestedPaths} deep path${
        flattenedNestedPaths === 1 ? "" : "s"
      } flattened)`
      : "";
    ui.setStatus(`Imported ${fileEntries.length} ZIP file(s)${suffix}.`);
  } catch (err) {
    showError(err, "Could not import ZIP.");
  }
}

function runIntegrityCheck() {
  if (!state.editor) return;
  try {
    const report = state.editor.scanIntegrity();
    state.integrityReport = report;
    renderIntegritySummary(report);
    if (report.summary.totalIssues === 0) {
      ui.setStatus("Integrity check completed: no issues found.");
    } else {
      ui.setStatus(
        `Integrity check found ${report.summary.totalIssues} issue(s).`,
        true,
      );
    }
  } catch (err) {
    showError(err, "Integrity check failed.");
  }
}

function applySafeRepair() {
  if (!state.editor) return;
  try {
    const report = state.integrityReport || state.editor.scanIntegrity();
    const pending = report.repairPlan.orphanClusters.length +
      report.repairPlan.lengthFixes.length;
    if (pending === 0) {
      ui.setStatus("No safe repairs available.");
      return;
    }
    if (!window.confirm(`Apply safe repair actions (${pending})?`)) return;

    runMutation("Apply safe repair", () => {
      state.editor.applySafeRepair(report);
    });
    refreshDirectoryView();
    const newReport = state.editor.scanIntegrity();
    state.integrityReport = newReport;
    renderIntegritySummary(newReport);
    ui.setStatus(`Applied safe repairs (${pending}).`);
  } catch (err) {
    showError(err, "Could not apply safe repair.");
  }
}

function rowContextItems(entry) {
  const writable = canMutateCard();
  const canAddFolder = canAddFolderHere();
  const items = [];

  if (entry.isParentNav) {
    items.push({ label: "Open Parent", run: () => goUp() });
    items.push({
      label: "Add File Here",
      run: () => addFileInput.click(),
      disabled: !writable,
    });
    items.push({
      label: "Add Folder Here",
      run: () => addFolderToCurrentDir(),
      disabled: !canAddFolder,
    });
    return items;
  }

  if (entry.isSearchResult) {
    items.push({ label: "Open Location", run: () => openSearchResult(entry) });
  } else if (entry.type === "directory") {
    items.push({ label: "Open Folder", run: () => openDirectoryEntry(entry) });
  }

  if (entry.type === "file") {
    items.push({ label: "Download File", run: () => downloadSelectedFile() });
  }
  if (entry.type === "directory") {
    items.push({
      label: "Export Folder ZIP",
      run: () => exportSelectedFolderZip(),
    });
  }
  if (entry.type === "file" || entry.type === "directory") {
    items.push({
      label: "Rename",
      run: () => promptRenameEntry(),
      disabled: !writable,
    });
    items.push({
      label: entry.type === "directory"
        ? "Delete Folder (Recursive)"
        : "Delete File",
      run: () => deleteSelectedEntry(),
      disabled: !writable,
      danger: true,
    });
  }

  items.push({
    label: "Add File Here",
    run: () => addFileInput.click(),
    disabled: !writable,
  });
  items.push({
    label: "Add Folder Here",
    run: () => addFolderToCurrentDir(),
    disabled: !canAddFolder,
  });
  return items;
}

function viewContextItems() {
  return [
    {
      label: "Add File Here",
      run: () => addFileInput.click(),
      disabled: !canMutateCard(),
    },
    {
      label: "Add Folder Here",
      run: () => addFolderToCurrentDir(),
      disabled: !canAddFolderHere(),
    },
    {
      label: "Import ZIP To Root",
      run: () => importZipButton.click(),
      disabled: !canMutateCard(),
    },
    {
      label: "Download Image",
      run: () => downloadCurrentImage(),
      disabled: !state.editor,
    },
    {
      label: "Check Integrity",
      run: () => runIntegrityCheck(),
      disabled: !state.editor,
    },
    {
      label: "Refresh View",
      run: () => refreshDirectoryView(),
      disabled: !state.parser,
    },
  ];
}

function handleRowContext(index, event) {
  if (!state.parser) return;
  handleRowClick(index);
  const entry = state.entries[index];
  if (!entry) return;
  openContextMenu(event.clientX, event.clientY, rowContextItems(entry));
}

function resetBrowserState() {
  closeContextMenu();
  clearTableDropHighlight();
  state.editor = null;
  state.parser = null;
  state.loadedFileName = "";
  state.dirStack = [];
  state.rawEntries = [];
  state.entries = [];
  state.selectedIndex = -1;
  state.selectedEntry = null;
  state.searchQuery = "";
  state.searchGlobal = false;
  state.baseIndex = null;
  state.currentIndex = null;
  state.integrityReport = null;
  history.reset();

  ui.clearCardInfo();
  ui.clearEntries();
  ui.renderEntryDetails(null);
  ui.renderChangeSummary("No pending changes.");
  renderIntegritySummary(null);
  ui.setPath("/");
  ui.setUpEnabled(false);
  updateEntryActionButtons(null);
  ui.setImageDownloadEnabled(false);
  ui.searchInput.value = "";
  ui.searchGlobalCheckbox.checked = false;
}

function setLoadedEditor(editor, fileName) {
  state.editor = editor;
  syncParserFromEditor();
  state.loadedFileName = fileName;
  state.dirStack = [{
    name: "",
    clusterRel: state.parser.getSummary().rootDirCluster,
  }];
  state.baseIndex = buildCardIndex(state.parser);
  history.reset();
  state.currentIndex = state.baseIndex;
  state.integrityReport = null;
  renderIntegritySummary(null);
}

async function loadImageFile(file) {
  resetBrowserState();
  ui.setStatus(`Loading ${file.name}...`);
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const editor = new Ps2MemoryCardEditor(buffer);
    setLoadedEditor(editor, file.name);

    const summary = state.parser.getSummary();
    ui.renderCardInfo(summary);
    ui.setImageDownloadEnabled(true);
    refreshDirectoryView();
    if (editor.isConvertedFromEcc()) {
      ui.setStatus(
        `Loaded ${file.name}. ECC layout was converted to raw writable image.`,
      );
    } else {
      ui.setStatus(`Loaded ${file.name} in read/write mode.`);
    }
  } catch (err) {
    showError(err, "Failed to parse memory card image.");
    resetBrowserState();
  }
}

function loadEmptyCard(sizeMb = 8) {
  resetBrowserState();
  ui.setStatus(`Creating empty ${sizeMb} MB card...`);
  try {
    const buffer = createEmptyPs2CardImage({ sizeMb });
    const editor = new Ps2MemoryCardEditor(buffer);
    setLoadedEditor(editor, `empty-${sizeMb}mb.mcd`);
    ui.renderCardInfo(state.parser.getSummary());
    ui.setImageDownloadEnabled(true);
    refreshDirectoryView();
    ui.setStatus(`Created empty ${sizeMb} MB card.`);
  } catch (err) {
    showError(err, "Could not create empty card.");
    resetBrowserState();
  }
}

async function loadFromList(fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  await loadImageFile(file);
}

function bindFileInputEvents() {
  imageInput.addEventListener("change", async (event) => {
    await loadFromList(event.target.files);
    event.target.value = "";
  });

  addFileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []).map((file) => ({
      file,
      relativePath: file.name,
    }));
    await addExternalFilesToCurrentDir(files);
    event.target.value = "";
  });

  importZipButton.addEventListener("click", () => {
    importZipInput.click();
  });

  importZipInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    await importZipToRoot(file);
    event.target.value = "";
  });
}

function bindDropZoneEvents() {
  dropZone.addEventListener("click", () => {
    imageInput.click();
  });

  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      imageInput.click();
    }
  });

  dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-active");
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-active");
  });

  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) {
      dropZone.classList.remove("drag-active");
    }
  });

  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-active");
    await loadFromList(event.dataTransfer && event.dataTransfer.files);
  });
}

function bindCardActions() {
  createEmptyCardButton.addEventListener("click", () => {
    const selected = Number(newCardSizeSelect.value);
    const sizeMb = Number.isFinite(selected) ? selected : 8;
    loadEmptyCard(sizeMb);
  });
}

function bindTableEvents() {
  tableWrap.addEventListener("dragenter", (event) => {
    if (!isFileDragEvent(event) || !state.parser) return;
    event.preventDefault();
    event.stopPropagation();
    state.tableDragDepth += 1;
    tableWrap.classList.add("file-drop-active");
  });

  tableWrap.addEventListener("dragover", (event) => {
    if (!isFileDragEvent(event) || !state.parser) return;
    event.preventDefault();
    event.stopPropagation();
    tableWrap.classList.add("file-drop-active");
  });

  tableWrap.addEventListener("dragleave", (event) => {
    if (!isFileDragEvent(event) || !state.parser) return;
    event.preventDefault();
    event.stopPropagation();
    state.tableDragDepth = Math.max(0, state.tableDragDepth - 1);
    if (state.tableDragDepth === 0) {
      tableWrap.classList.remove("file-drop-active");
    }
  });

  tableWrap.addEventListener("drop", async (event) => {
    if (!isFileDragEvent(event) || !state.parser) return;
    event.preventDefault();
    event.stopPropagation();
    clearTableDropHighlight();
    if (!canMutateCard()) {
      ui.setStatus("This image is read-only. Drop-upload is disabled.", true);
      return;
    }

    try {
      const dropped = await collectDroppedItems(event.dataTransfer);
      await addExternalFilesToCurrentDir(dropped);
    } catch (err) {
      showError(err, "Could not import dropped files.");
    }
  });

  tableWrap.addEventListener("contextmenu", (event) => {
    if (!state.parser) return;
    const target = event.target instanceof Element ? event.target : null;
    const inBodyRowByClosest = Boolean(target && target.closest("tbody tr"));
    const path = typeof event.composedPath === "function"
      ? event.composedPath()
      : [];
    const inBodyRowByPath = path.some((node) =>
      node instanceof HTMLTableRowElement &&
      node.parentElement &&
      node.parentElement.tagName === "TBODY"
    );
    if (inBodyRowByClosest || inBodyRowByPath) {
      return;
    }
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, viewContextItems());
  });
}

function bindSearchEvents() {
  ui.searchInput.addEventListener("input", () => {
    state.searchQuery = ui.searchInput.value || "";
    renderEntries();
  });

  ui.searchGlobalCheckbox.addEventListener("change", () => {
    state.searchGlobal = ui.searchGlobalCheckbox.checked;
    renderEntries();
  });
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) {
      closeContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeContextMenu();
      clearTableDropHighlight();
    }
  });

  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
  document.addEventListener("scroll", closeContextMenu, true);
}

function bindEntryActionButtons() {
  ui.downloadEntryButton.addEventListener(
    "click",
    () => downloadSelectedFile(),
  );
  ui.renameEntryButton.addEventListener("click", () => promptRenameEntry());
  ui.deleteEntryButton.addEventListener("click", () => deleteSelectedEntry());
  ui.exportFolderZipButton.addEventListener("click", async () => {
    await exportSelectedFolderZip();
  });
  ui.downloadImageButton.addEventListener(
    "click",
    () => downloadCurrentImage(),
  );
  ui.undoButton.addEventListener("click", () => undoLast());
  ui.redoButton.addEventListener("click", () => redoLast());
  ui.checkIntegrityButton.addEventListener("click", () => runIntegrityCheck());
  ui.applyRepairButton.addEventListener("click", () => applySafeRepair());
  ui.upButton.addEventListener("click", () => goUp());
}

function initApp() {
  bindFileInputEvents();
  bindDropZoneEvents();
  bindCardActions();
  bindTableEvents();
  bindSearchEvents();
  bindGlobalEvents();
  bindEntryActionButtons();
}

initApp();
