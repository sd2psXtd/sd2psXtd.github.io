import { formatBytes, formatHex } from "./constants.js";

function fmtDate(ts) {
  return ts ? ts.toString() : "n/a";
}

function row(label, value) {
  return `<dt>${label}</dt><dd>${value}</dd>`;
}

export class BrowserUI {
  constructor() {
    this.statusText = document.getElementById("statusText");
    this.cardInfo = document.getElementById("cardInfo");
    this.pathText = document.getElementById("pathText");
    this.entryTableBody = document.querySelector("#entryTable tbody");
    this.entryDetails = document.getElementById("entryDetails");
    this.changeSummary = document.getElementById("changeSummary");
    this.integritySummary = document.getElementById("integritySummary");
    this.searchInput = document.getElementById("searchInput");
    this.searchGlobalCheckbox = document.getElementById("searchGlobalCheckbox");
    this.upButton = document.getElementById("upButton");
    this.downloadEntryButton = document.getElementById("downloadEntryButton");
    this.renameEntryButton = document.getElementById("renameEntryButton");
    this.deleteEntryButton = document.getElementById("deleteEntryButton");
    this.exportFolderZipButton = document.getElementById(
      "exportFolderZipButton",
    );
    this.downloadImageButton = document.getElementById("downloadImageButton");
    this.undoButton = document.getElementById("undoButton");
    this.redoButton = document.getElementById("redoButton");
    this.checkIntegrityButton = document.getElementById("checkIntegrityButton");
    this.applyRepairButton = document.getElementById("applyRepairButton");
  }

  setStatus(text, isError = false) {
    this.statusText.textContent = text;
    this.statusText.classList.toggle("error", isError);
  }

  clearCardInfo() {
    this.cardInfo.innerHTML = "";
  }

  renderCardInfo(summary) {
    const usage = summary.usage;
    this.cardInfo.innerHTML = [
      row("Magic", summary.magic),
      row("Image Size", formatBytes(summary.imageSize)),
      row("Page Length", `${summary.pageLength} bytes`),
      row("Page Physical", `${summary.pagePhysicalSize} bytes`),
      row("ECC Layout", summary.hasEcc ? "Yes" : "No"),
      row("Pages / Cluster", summary.pagesPerCluster),
      row("Cluster Size", formatBytes(summary.clusterDataSize)),
      row("Clusters / Card", summary.clustersPerCard),
      row("Alloc Offset", `${summary.allocOffset}`),
      row("Alloc Count", `${summary.allocatableClusterCount}`),
      row("Root Dir Cluster", `${summary.rootDirCluster}`),
      row("Used / Free", `${usage.usedClusters} / ${usage.freeClusters}`),
      row("Used Bytes", formatBytes(usage.usedBytes)),
      row("Free Bytes", formatBytes(usage.freeBytes)),
    ].join("");
  }

  setPath(pathText) {
    this.pathText.textContent = pathText;
  }

  setUpEnabled(enabled) {
    this.upButton.disabled = !enabled;
  }

  setDownloadEnabled(enabled) {
    this.downloadEntryButton.disabled = !enabled;
  }

  setDeleteEnabled(enabled) {
    this.deleteEntryButton.disabled = !enabled;
  }

  setRenameEnabled(enabled) {
    this.renameEntryButton.disabled = !enabled;
  }

  setExportFolderEnabled(enabled) {
    this.exportFolderZipButton.disabled = !enabled;
  }

  setImageDownloadEnabled(enabled) {
    this.downloadImageButton.disabled = !enabled;
  }

  setUndoRedoEnabled(canUndo, canRedo) {
    this.undoButton.disabled = !canUndo;
    this.redoButton.disabled = !canRedo;
  }

  setIntegrityActionsEnabled(canCheck, canRepair) {
    this.checkIntegrityButton.disabled = !canCheck;
    this.applyRepairButton.disabled = !canRepair;
  }

  renderChangeSummary(text) {
    this.changeSummary.textContent = text;
  }

  renderIntegritySummary(text) {
    this.integritySummary.textContent = text;
  }

  clearEntries() {
    this.entryTableBody.innerHTML = "";
  }

  renderEntries(
    entries,
    selectedIndex,
    onRowClick,
    onRowDoubleClick,
    onRowContext,
  ) {
    this.entryTableBody.innerHTML = "";
    entries.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      if (idx === selectedIndex) {
        tr.classList.add("selected");
      }

      const isParentNav = entry.isParentNav === true;
      const icon = isParentNav
        ? "↩"
        : entry.type === "directory"
        ? "📁"
        : entry.type === "file"
        ? "📄"
        : "•";
      const typeText = isParentNav ? "parent" : entry.type;
      const sizeText = isParentNav
        ? ""
        : entry.type === "file"
        ? formatBytes(entry.length)
        : `${entry.length} entries`;
      const clusterText = isParentNav
        ? ""
        : entry.clusterRel === 0xffffffff
        ? "EOC"
        : entry.clusterRel;
      const modifiedText = isParentNav ? "" : fmtDate(entry.modified);
      tr.innerHTML = `
        <td class="name-cell"><span class="icon">${icon}</span><span>${entry.name}</span></td>
        <td>${typeText}</td>
        <td class="size-cell">${sizeText}</td>
        <td class="cluster-cell">${clusterText}</td>
        <td>${modifiedText}</td>
      `;

      tr.addEventListener("click", () => onRowClick(idx));
      tr.addEventListener("dblclick", () => onRowDoubleClick(idx));
      if (typeof onRowContext === "function") {
        tr.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onRowContext(idx, event);
        });
      }
      this.entryTableBody.appendChild(tr);
    });
  }

  renderEntryDetails(entry, extra = "") {
    if (!entry) {
      this.entryDetails.textContent = extra ||
        "Select a file or directory entry.";
      return;
    }
    const modeBits = `${formatHex(entry.mode)} (${
      entry.mode.toString(2).padStart(16, "0")
    })`;
    const lines = [
      `Name: ${entry.name}`,
      `Type: ${entry.type}`,
      `Mode: ${modeBits}`,
      `Length: ${entry.length}`,
      `Start Cluster: ${
        entry.clusterRel === 0xffffffff ? "EOC/None" : entry.clusterRel
      }`,
      `Entry Index: ${entry.entryIndex}`,
      `Attributes: ${formatHex(entry.attr)}`,
      `Created: ${fmtDate(entry.created)}`,
      `Modified: ${fmtDate(entry.modified)}`,
    ];
    if (extra) lines.push("", extra);
    this.entryDetails.textContent = lines.join("\n");
  }

  renderFilePreview(dataBytes, maxRows = 12) {
    if (!dataBytes || dataBytes.length === 0) return "";

    const rows = [];
    const lineWidth = 16;
    const count = Math.min(dataBytes.length, maxRows * lineWidth);
    for (let offset = 0; offset < count; offset += lineWidth) {
      const chunk = dataBytes.subarray(
        offset,
        Math.min(offset + lineWidth, count),
      );
      const hex = Array.from(chunk).map((v) => v.toString(16).padStart(2, "0"))
        .join(" ");
      const ascii = Array.from(chunk).map((
        v,
      ) => (v >= 32 && v <= 126 ? String.fromCharCode(v) : ".")).join("");
      rows.push(
        `${offset.toString(16).padStart(6, "0")}  ${
          hex.padEnd(47, " ")
        }  ${ascii}`,
      );
    }
    if (count < dataBytes.length) {
      rows.push(`... (${dataBytes.length - count} more bytes)`);
    }
    return rows.join("\n");
  }
}
