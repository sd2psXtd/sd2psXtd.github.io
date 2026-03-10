export function sanitizeDownloadName(name) {
  const cleaned = String(name || "")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return cleaned || "memory-card-file.bin";
}

export function isFileDragEvent(event) {
  const dt = event && event.dataTransfer;
  if (!dt) return false;
  if (!dt.types) return true;
  return Array.from(dt.types).includes("Files");
}

export function sanitizeImportedName(rawName) {
  let out = String(rawName || "")
    .replace(/[\/\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  if (!out) out = "file.bin";
  if (out.length > 31) out = out.slice(0, 31);
  return out;
}

export function uniqueName(baseName, usedNames) {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : "";
  let n = 1;
  while (n < 10000) {
    const suffix = `_${n}`;
    const candidateStem = `${stem}${suffix}`.slice(
      0,
      Math.max(1, 31 - ext.length),
    );
    const candidate = `${candidateStem}${ext}`.slice(0, 31);
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    n += 1;
  }
  throw new Error("Could not derive unique filename.");
}

export async function readFileAsArrayBuffer(file) {
  if (file && typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("File reader did not return binary data."));
      }
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read file."));
    reader.readAsArrayBuffer(file);
  });
}

function readEntryFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(file),
      (err) => reject(err || new Error("Could not read dropped file entry.")),
    );
  });
}

async function walkDroppedEntry(entry, pathPrefix = "") {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return [{ file, relativePath: `${pathPrefix}${file.name}` }];
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const out = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch || batch.length === 0) break;
    for (const child of batch) {
      const nested = await walkDroppedEntry(
        child,
        `${pathPrefix}${entry.name}/`,
      );
      out.push(...nested);
    }
  }
  return out;
}

export async function collectDroppedItems(dataTransfer) {
  const out = [];
  if (!dataTransfer) return out;

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const itemEntries = [];
    for (const item of dataTransfer.items) {
      if (typeof item.webkitGetAsEntry === "function") {
        const entry = item.webkitGetAsEntry();
        if (entry) itemEntries.push(entry);
      } else if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) out.push({ file, relativePath: file.name });
      }
    }
    if (itemEntries.length > 0) {
      for (const entry of itemEntries) {
        const walked = await walkDroppedEntry(entry, "");
        out.push(...walked);
      }
      return out;
    }
  }

  const files = Array.from(dataTransfer.files || []);
  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    out.push({ file, relativePath });
  }
  return out;
}

export function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
