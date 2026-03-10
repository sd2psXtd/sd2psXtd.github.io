import { DIRENT_SIZE, ENTRY_MODE, FAT } from "./constants.js";
import { Ps2MemoryCardParser } from "./ps2mc-parser.js";

const MODE_FILE_DEFAULT = ENTRY_MODE.EXISTS | ENTRY_MODE.FILE |
  ENTRY_MODE.READ | ENTRY_MODE.WRITE | ENTRY_MODE.EXECUTE |
  ENTRY_MODE.FILE_EXTRA | ENTRY_MODE.PS2_VALID;
const MODE_DIRECTORY_DEFAULT = ENTRY_MODE.EXISTS | ENTRY_MODE.DIRECTORY |
  ENTRY_MODE.READ | ENTRY_MODE.WRITE | ENTRY_MODE.EXECUTE |
  ENTRY_MODE.PS2_VALID;

export class Ps2MemoryCardEditor {
  constructor(arrayBuffer) {
    this.bytes = new Uint8Array(arrayBuffer.slice(0));
    this.parser = new Ps2MemoryCardParser(this.bytes.buffer);
    this.encoder = new TextEncoder();
    this.sourceHadEcc = this.parser.layout.hasEcc;
    this.convertedFromEcc = false;

    if (this.sourceHadEcc) {
      this.bytes = this._convertEccImageToRaw(this.parser);
      this.parser = new Ps2MemoryCardParser(this.bytes.buffer);
      this.convertedFromEcc = true;
    }
  }

  getParser() {
    return this.parser;
  }

  getImageSize() {
    return this.bytes.length;
  }

  getArrayBufferCopy() {
    return this.bytes.buffer.slice(0);
  }

  loadFromArrayBuffer(arrayBuffer) {
    this.bytes = new Uint8Array(arrayBuffer.slice(0));
    this._refreshParser();
  }

  getImageBlob() {
    return new Blob([this.bytes], { type: "application/octet-stream" });
  }

  canMutate() {
    return true;
  }

  isConvertedFromEcc() {
    return this.convertedFromEcc;
  }

  _convertEccImageToRaw(parser) {
    const s = parser.superblock;
    const raw = new Uint8Array(s.clustersPerCard * s.clusterDataSize);
    let offset = 0;
    for (let abs = 0; abs < s.clustersPerCard; abs += 1) {
      const cluster = parser.readClusterDataAbsolute(abs);
      raw.set(cluster, offset);
      offset += cluster.length;
    }
    return raw;
  }

  _refreshParser() {
    this.parser = new Ps2MemoryCardParser(this.bytes.buffer);
  }

  _clusterAbsFromRel(relCluster) {
    return this.parser.superblock.allocOffset + relCluster;
  }

  _readClusterWords(absCluster) {
    const bytes = this.parser.readClusterDataAbsolute(absCluster);
    const words = new Uint32Array(this.parser.entriesPerCluster);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < words.length; i += 1) {
      words[i] = dv.getUint32(i * 4, true);
    }
    return words;
  }

  _writeClusterDataAbsolute(absCluster, dataClusterBytes) {
    const s = this.parser.superblock;
    if (
      !(dataClusterBytes instanceof Uint8Array) ||
      dataClusterBytes.length !== s.clusterDataSize
    ) {
      throw new Error("Invalid cluster payload size.");
    }

    const layout = this.parser.layout;
    const start = absCluster * layout.clusterPhysicalSize;
    for (let page = 0; page < s.pagesPerCluster; page += 1) {
      const srcOffset = page * s.pageLength;
      const dstOffset = start + page * layout.pagePhysicalSize;
      this.bytes.set(
        dataClusterBytes.subarray(srcOffset, srcOffset + s.pageLength),
        dstOffset,
      );
    }
    this.parser.clusterWordCache.clear();
  }

  _writeClusterDataRel(relCluster, dataClusterBytes) {
    this._writeClusterDataAbsolute(
      this._clusterAbsFromRel(relCluster),
      dataClusterBytes,
    );
  }

  _fatAddress(relCluster) {
    const epc = this.parser.entriesPerCluster;
    const fatOffset = relCluster % epc;
    const indirectIndex = Math.floor(relCluster / epc);
    const indirectOffset = indirectIndex % epc;
    const dblIndirectIndex = Math.floor(indirectIndex / epc);

    const indirectCluster = this.parser.superblock.ifcList[dblIndirectIndex];
    if (
      !Number.isFinite(indirectCluster) || indirectCluster === 0 ||
      indirectCluster === FAT.END_OF_CHAIN
    ) {
      throw new Error(
        `FAT indirect cluster missing for relative cluster ${relCluster}.`,
      );
    }

    const indirectWords = this._readClusterWords(indirectCluster);
    const fatCluster = indirectWords[indirectOffset];
    if (
      !Number.isFinite(fatCluster) || fatCluster === 0 ||
      fatCluster === FAT.END_OF_CHAIN
    ) {
      throw new Error(
        `FAT cluster missing for relative cluster ${relCluster}.`,
      );
    }

    return { fatCluster, fatOffset };
  }

  _setFatEntry(relCluster, fatValue) {
    const { fatCluster, fatOffset } = this._fatAddress(relCluster);
    const clusterBytes = this.parser.readClusterDataAbsolute(fatCluster);
    const dv = new DataView(
      clusterBytes.buffer,
      clusterBytes.byteOffset,
      clusterBytes.byteLength,
    );
    dv.setUint32(fatOffset * 4, fatValue >>> 0, true);
    this._writeClusterDataAbsolute(fatCluster, clusterBytes);
  }

  _isClusterFree(relCluster) {
    const fatValue = this.parser.getFatEntry(relCluster);
    return (fatValue & FAT.CHAIN_FLAG) === 0;
  }

  _allocateClusters(count) {
    if (count <= 0) return [];

    const found = [];
    for (
      let rel = 0;
      rel < this.parser.allocatableClusterCount && found.length < count;
      rel += 1
    ) {
      if (this._isClusterFree(rel)) {
        found.push(rel);
      }
    }
    if (found.length !== count) {
      throw new Error(
        `Not enough free space. Need ${count} clusters, found ${found.length}.`,
      );
    }

    for (let i = 0; i < found.length; i += 1) {
      const current = found[i];
      const next = i + 1 < found.length ? found[i + 1] : FAT.END_OF_CHAIN;
      const fatValue = next === FAT.END_OF_CHAIN
        ? FAT.END_OF_CHAIN
        : (FAT.CHAIN_FLAG | next);
      this._setFatEntry(current, fatValue >>> 0);
    }
    this._refreshParser();
    return found;
  }

  _freeClusterChain(relStartCluster) {
    if (relStartCluster === FAT.END_OF_CHAIN) return;

    const chain = this.parser.getClusterChain(relStartCluster);
    for (const rel of chain) {
      this._setFatEntry(rel, 0);
    }
    this._refreshParser();
  }

  _findFreeDirSlot(relDirStartCluster) {
    const data = this.parser.readClusterChainData(relDirStartCluster);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = Math.floor(data.length / DIRENT_SIZE);

    for (let i = 0; i < count; i += 1) {
      const base = i * DIRENT_SIZE;
      const mode = dv.getUint16(base + 0x00, true);
      const exists = (mode & ENTRY_MODE.EXISTS) !== 0;
      if (!exists || mode === 0xffff) {
        return i;
      }

      const length = dv.getUint32(base + 0x04, true);
      const clusterRel = dv.getUint32(base + 0x10, true);
      const entryIndex = dv.getUint32(base + 0x14, true);
      const attr = dv.getUint32(base + 0x20, true);
      const looksErased = length === 0xffffffff &&
        clusterRel === 0xffffffff &&
        entryIndex === 0xffffffff &&
        attr === 0xffffffff;
      if (looksErased) {
        return i;
      }
    }

    return null;
  }

  _expandDirectory(relDirStartCluster) {
    const oldChain = this.parser.getClusterChain(relDirStartCluster);
    if (oldChain.length === 0) {
      throw new Error("Directory has no FAT chain.");
    }

    const slotsPerCluster = Math.max(
      1,
      Math.floor(this.parser.superblock.clusterDataSize / DIRENT_SIZE),
    );
    const firstNewSlot = oldChain.length * slotsPerCluster;

    const allocated = this._allocateClusters(1);
    const newRelCluster = allocated[0];
    try {
      const lastOldRelCluster = oldChain[oldChain.length - 1];
      this._setFatEntry(lastOldRelCluster, FAT.CHAIN_FLAG | newRelCluster);
      this._setFatEntry(newRelCluster, FAT.END_OF_CHAIN);
      this._writeClusterDataRel(
        newRelCluster,
        new Uint8Array(this.parser.superblock.clusterDataSize),
      );
      this._refreshParser();
    } catch (err) {
      try {
        this._freeClusterChain(newRelCluster);
      } catch (_) {
        // Ignore rollback failures; original error is more relevant.
      }
      throw err;
    }

    return firstNewSlot;
  }

  _findDirSlotOrExpand(relDirStartCluster) {
    const slot = this._findFreeDirSlot(relDirStartCluster);
    if (slot !== null) return slot;
    return this._expandDirectory(relDirStartCluster);
  }

  _serializeTimestamp(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date();
    const out = new Uint8Array(8);
    out[0] = 0;
    out[1] = d.getSeconds() & 0xff;
    out[2] = d.getMinutes() & 0xff;
    out[3] = d.getHours() & 0xff;
    out[4] = d.getDate() & 0xff;
    out[5] = (d.getMonth() + 1) & 0xff;
    const year = d.getFullYear() & 0xffff;
    out[6] = year & 0xff;
    out[7] = (year >> 8) & 0xff;
    return out;
  }

  _normalizeName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      throw new Error("Name must not be empty.");
    }
    if (trimmed === "." || trimmed === "..") {
      throw new Error("'.' and '..' are reserved names.");
    }
    if (/[\/\\:*?"<>|]/.test(trimmed)) {
      throw new Error("Name contains unsupported characters.");
    }
    for (let i = 0; i < trimmed.length; i += 1) {
      const c = trimmed.charCodeAt(i);
      if (c < 0x20 || c === 0x7f || c > 0x7f) {
        throw new Error("Only ASCII names are supported for now.");
      }
    }

    const encoded = this.encoder.encode(trimmed);
    if (encoded.length > 31) {
      throw new Error("Name is too long. Maximum is 31 ASCII bytes.");
    }

    const out = new Uint8Array(0x20);
    out.set(encoded);
    return {
      name: trimmed,
      nameBytes: out,
    };
  }

  _nameBytesFromAscii(name) {
    const encoded = this.encoder.encode(name);
    const out = new Uint8Array(0x20);
    out.set(encoded.subarray(0, Math.min(encoded.length, 31)));
    return out;
  }

  _buildDirEntry({
    mode,
    length,
    clusterRel,
    entryIndex = 0,
    attr = 0,
    nameBytes,
    created,
    modified,
  }) {
    const out = new Uint8Array(DIRENT_SIZE);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    dv.setUint16(0x00, mode >>> 0, true);
    dv.setUint16(0x02, 0, true);
    dv.setUint32(0x04, length >>> 0, true);
    out.set(this._serializeTimestamp(created), 0x08);
    dv.setUint32(0x10, clusterRel >>> 0, true);
    dv.setUint32(0x14, entryIndex >>> 0, true);
    out.set(this._serializeTimestamp(modified || created), 0x18);
    dv.setUint32(0x20, attr >>> 0, true);
    out.set(nameBytes, 0x40);
    return out;
  }

  _writeDirEntryAtSlot(relDirStartCluster, slotIndex, dirEntryBytes) {
    if (slotIndex < 0) {
      throw new Error("Invalid directory slot index.");
    }

    const chain = this.parser.getClusterChain(relDirStartCluster);
    if (chain.length === 0) {
      throw new Error("Directory cluster chain is empty.");
    }

    const slotsPerCluster = Math.max(
      1,
      Math.floor(this.parser.superblock.clusterDataSize / DIRENT_SIZE),
    );
    const chainIndex = Math.floor(slotIndex / slotsPerCluster);
    if (chainIndex >= chain.length) {
      throw new Error("Directory slot index exceeds chain length.");
    }

    const relCluster = chain[chainIndex];
    const offsetInCluster = (slotIndex % slotsPerCluster) * DIRENT_SIZE;
    const absCluster = this._clusterAbsFromRel(relCluster);
    const clusterBytes = this.parser.readClusterDataAbsolute(absCluster);
    clusterBytes.set(dirEntryBytes, offsetInCluster);
    this._writeClusterDataRel(relCluster, clusterBytes);
  }

  _slotLocation(relDirStartCluster, slotIndex) {
    if (slotIndex < 0) {
      throw new Error("Invalid directory slot index.");
    }

    const chain = this.parser.getClusterChain(relDirStartCluster);
    if (chain.length === 0) {
      throw new Error("Directory cluster chain is empty.");
    }
    const slotsPerCluster = Math.max(
      1,
      Math.floor(this.parser.superblock.clusterDataSize / DIRENT_SIZE),
    );
    const chainIndex = Math.floor(slotIndex / slotsPerCluster);
    if (chainIndex >= chain.length) {
      throw new Error("Directory slot index exceeds chain length.");
    }

    const relCluster = chain[chainIndex];
    const offsetInCluster = (slotIndex % slotsPerCluster) * DIRENT_SIZE;
    return {
      relCluster,
      offsetInCluster,
    };
  }

  _overwriteEntryName(relDirStartCluster, slotIndex, nameBytes) {
    const loc = this._slotLocation(relDirStartCluster, slotIndex);
    const absCluster = this._clusterAbsFromRel(loc.relCluster);
    const clusterBytes = this.parser.readClusterDataAbsolute(absCluster);
    clusterBytes.set(nameBytes, loc.offsetInCluster + 0x40);
    this._writeClusterDataRel(loc.relCluster, clusterBytes);
  }

  _setEntryLength(relDirStartCluster, slotIndex, newLength) {
    const loc = this._slotLocation(relDirStartCluster, slotIndex);
    const absCluster = this._clusterAbsFromRel(loc.relCluster);
    const clusterBytes = this.parser.readClusterDataAbsolute(absCluster);
    const dv = new DataView(
      clusterBytes.buffer,
      clusterBytes.byteOffset,
      clusterBytes.byteLength,
    );
    dv.setUint32(loc.offsetInCluster + 0x04, newLength >>> 0, true);
    this._writeClusterDataRel(loc.relCluster, clusterBytes);
  }

  _adjustDirectoryLength(relDirStartCluster, delta) {
    if (relDirStartCluster !== this.parser.superblock.rootDirCluster) return;
    const dot = this.parser.parseDirectory(relDirStartCluster, true).find(
      (entry) => entry.type === "directory" && entry.name === ".",
    );
    if (!dot || !Number.isFinite(dot.slotIndex)) return;
    const current = Number(dot.length) || 0;
    const next = Math.max(0, current + delta);
    this._setEntryLength(relDirStartCluster, dot.slotIndex, next);
  }

  _findParentDirectoryLocation(childRelCluster) {
    const root = this.parser.superblock.rootDirCluster;
    if (childRelCluster === root) return null;

    const queue = [root];
    const seen = new Set();
    while (queue.length > 0) {
      const parentRel = queue.shift();
      if (seen.has(parentRel)) continue;
      seen.add(parentRel);

      const children = this.parser.parseDirectory(parentRel, false);
      for (const child of children) {
        if (child.type !== "directory") continue;
        if (child.clusterRel === childRelCluster) {
          return {
            parentClusterRel: parentRel,
            slotIndex: child.slotIndex,
          };
        }
        queue.push(child.clusterRel);
      }
    }
    return null;
  }

  _syncDirectoryLengthInParent(relDirStartCluster) {
    const parent = this._findParentDirectoryLocation(relDirStartCluster);
    if (!parent) return;
    const childEntries = this.parser.parseDirectory(relDirStartCluster, false);
    const newLength = Math.max(2, childEntries.length + 2);
    this._setEntryLength(parent.parentClusterRel, parent.slotIndex, newLength);
  }

  _assertNameDoesNotExist(relDirStartCluster, name) {
    const entries = this.parser.parseDirectory(relDirStartCluster, false);
    if (entries.some((entry) => entry.name === name)) {
      throw new Error(`Entry already exists: ${name}`);
    }
  }

  addFile(relDirStartCluster, fileName, fileBytes) {
    if (!(fileBytes instanceof Uint8Array)) {
      fileBytes = new Uint8Array(fileBytes);
    }

    const normalized = this._normalizeName(fileName);
    this._assertNameDoesNotExist(relDirStartCluster, normalized.name);

    const clusterSize = this.parser.superblock.clusterDataSize;
    const neededClusters = fileBytes.length === 0
      ? 0
      : Math.ceil(fileBytes.length / clusterSize);
    const allocated = this._allocateClusters(neededClusters);
    const startCluster = allocated.length > 0 ? allocated[0] : FAT.END_OF_CHAIN;

    try {
      for (let i = 0; i < allocated.length; i += 1) {
        const chunk = new Uint8Array(clusterSize);
        const srcStart = i * clusterSize;
        const srcEnd = Math.min(srcStart + clusterSize, fileBytes.length);
        chunk.set(fileBytes.subarray(srcStart, srcEnd), 0);
        this._writeClusterDataRel(allocated[i], chunk);
      }

      const slotIndex = this._findDirSlotOrExpand(relDirStartCluster);
      const now = new Date();
      const dirEntry = this._buildDirEntry({
        mode: MODE_FILE_DEFAULT,
        length: fileBytes.length,
        clusterRel: startCluster,
        entryIndex: 0,
        attr: 0,
        nameBytes: normalized.nameBytes,
        created: now,
        modified: now,
      });
      this._writeDirEntryAtSlot(relDirStartCluster, slotIndex, dirEntry);
      this._adjustDirectoryLength(relDirStartCluster, 1);
      this._syncDirectoryLengthInParent(relDirStartCluster);
      this._refreshParser();
    } catch (err) {
      if (allocated.length > 0) {
        try {
          this._freeClusterChain(startCluster);
        } catch (_) {
          // Ignore rollback failures; original error is more relevant.
        }
      }
      throw err;
    }
  }

  addDirectory(relDirStartCluster, dirName) {
    if (relDirStartCluster !== this.parser.superblock.rootDirCluster) {
      throw new Error(
        "Nested folders are not allowed. Create folders only in root.",
      );
    }

    const normalized = this._normalizeName(dirName);
    this._assertNameDoesNotExist(relDirStartCluster, normalized.name);

    const slotIndex = this._findDirSlotOrExpand(relDirStartCluster);
    const allocated = this._allocateClusters(1);
    const newDirCluster = allocated[0];

    try {
      const now = new Date();
      const parentDot = this.parser.parseDirectory(relDirStartCluster, true)
        .find(
          (entry) => entry.type === "directory" && entry.name === ".",
        );
      const parentDirEntryIndex =
        parentDot && Number.isFinite(parentDot.entryIndex)
          ? parentDot.entryIndex
          : 0;
      const parentClusterForDotDot = parentDot &&
          Number.isFinite(parentDot.clusterRel)
        ? parentDot.clusterRel
        : relDirStartCluster;

      const dirClusterData = new Uint8Array(
        this.parser.superblock.clusterDataSize,
      );
      const dotEntry = this._buildDirEntry({
        mode: MODE_DIRECTORY_DEFAULT,
        length: 0,
        clusterRel: relDirStartCluster,
        entryIndex: slotIndex,
        attr: 0,
        nameBytes: this._nameBytesFromAscii("."),
        created: now,
        modified: now,
      });
      const dotDotEntry = this._buildDirEntry({
        mode: MODE_DIRECTORY_DEFAULT,
        length: 0,
        clusterRel: parentClusterForDotDot,
        entryIndex: parentDirEntryIndex,
        attr: 0,
        nameBytes: this._nameBytesFromAscii(".."),
        created: parentDot && parentDot.created ? parentDot.created : now,
        modified: now,
      });
      dirClusterData.set(dotEntry, 0);
      dirClusterData.set(dotDotEntry, DIRENT_SIZE);
      this._writeClusterDataRel(newDirCluster, dirClusterData);

      const parentEntry = this._buildDirEntry({
        mode: MODE_DIRECTORY_DEFAULT,
        length: 2,
        clusterRel: newDirCluster,
        entryIndex: 0,
        attr: 0,
        nameBytes: normalized.nameBytes,
        created: now,
        modified: now,
      });
      this._writeDirEntryAtSlot(relDirStartCluster, slotIndex, parentEntry);
      this._adjustDirectoryLength(relDirStartCluster, 1);
      this._refreshParser();
    } catch (err) {
      try {
        this._freeClusterChain(newDirCluster);
      } catch (_) {
        // Ignore rollback failures; original error is more relevant.
      }
      throw err;
    }
  }

  renameEntry(relDirStartCluster, entry, newName) {
    if (!entry || entry.isParentNav || !Number.isFinite(entry.slotIndex)) {
      throw new Error("Invalid entry selection.");
    }
    const normalized = this._normalizeName(newName);
    if (normalized.name === entry.name) {
      return;
    }
    this._assertNameDoesNotExist(relDirStartCluster, normalized.name);
    this._overwriteEntryName(
      relDirStartCluster,
      entry.slotIndex,
      normalized.nameBytes,
    );
    this._refreshParser();
  }

  _analyzeChain(relStartCluster) {
    const result = {
      chain: [],
      hasLoop: false,
      outOfRange: false,
      dangling: false,
      endedWithEoc: false,
    };

    if (relStartCluster === FAT.END_OF_CHAIN) {
      result.endedWithEoc = true;
      return result;
    }

    const seen = new Set();
    let current = relStartCluster;

    while (true) {
      if (current === FAT.END_OF_CHAIN) {
        result.endedWithEoc = true;
        return result;
      }
      if (current < 0 || current >= this.parser.allocatableClusterCount) {
        result.outOfRange = true;
        return result;
      }
      if (seen.has(current)) {
        result.hasLoop = true;
        return result;
      }
      seen.add(current);
      result.chain.push(current);

      const fatValue = this.parser.getFatEntry(current);
      if (fatValue === FAT.END_OF_CHAIN) {
        result.endedWithEoc = true;
        return result;
      }
      if ((fatValue & FAT.CHAIN_FLAG) === 0) {
        result.dangling = true;
        return result;
      }
      current = fatValue & ~FAT.CHAIN_FLAG;
    }
  }

  scanIntegrity() {
    const findings = [];
    const repairPlan = {
      orphanClusters: [],
      lengthFixes: [],
    };

    const root = this.parser.superblock.rootDirCluster;
    const queue = [{ clusterRel: root, path: "/" }];
    const seenDirs = new Set();
    const reachableClusters = new Set();
    const clusterSize = this.parser.superblock.clusterDataSize;

    while (queue.length > 0) {
      const currentDir = queue.shift();
      if (seenDirs.has(currentDir.clusterRel)) continue;
      seenDirs.add(currentDir.clusterRel);

      const dirChain = this._analyzeChain(currentDir.clusterRel);
      for (const c of dirChain.chain) {
        reachableClusters.add(c);
      }
      if (dirChain.hasLoop || dirChain.outOfRange || dirChain.dangling) {
        findings.push({
          type: "dir_chain_corrupt",
          path: currentDir.path,
          detail:
            "Directory cluster chain has loop/out-of-range/dangling links.",
        });
      }

      const entries = this.parser.parseDirectory(currentDir.clusterRel, false);
      for (const entry of entries) {
        const fullPath = `${currentDir.path}${entry.name}`;
        if (entry.type === "directory") {
          queue.push({ clusterRel: entry.clusterRel, path: `${fullPath}/` });
          continue;
        }
        if (entry.type !== "file") continue;

        const fileChain = this._analyzeChain(entry.clusterRel);
        for (const c of fileChain.chain) {
          reachableClusters.add(c);
        }
        if (fileChain.hasLoop || fileChain.outOfRange || fileChain.dangling) {
          findings.push({
            type: "file_chain_corrupt",
            path: fullPath,
            detail: "File cluster chain has loop/out-of-range/dangling links.",
          });
        }

        const maxLength = fileChain.chain.length * clusterSize;
        if (entry.length > maxLength) {
          findings.push({
            type: "file_length_too_large",
            path: fullPath,
            detail:
              `File length ${entry.length} exceeds reachable chain bytes ${maxLength}.`,
            declaredLength: entry.length,
            maxLength,
          });
          repairPlan.lengthFixes.push({
            parentClusterRel: currentDir.clusterRel,
            slotIndex: entry.slotIndex,
            newLength: maxLength,
          });
        }
      }
    }

    for (let rel = 0; rel < this.parser.allocatableClusterCount; rel += 1) {
      const fatValue = this.parser.getFatEntry(rel);
      const isUsed = (fatValue & FAT.CHAIN_FLAG) !== 0;
      if (isUsed && !reachableClusters.has(rel)) {
        repairPlan.orphanClusters.push(rel);
      }
    }
    if (repairPlan.orphanClusters.length > 0) {
      findings.push({
        type: "orphan_clusters",
        path: "/",
        detail:
          `Found ${repairPlan.orphanClusters.length} orphan used clusters.`,
      });
    }

    return {
      findings,
      repairPlan,
      summary: {
        totalIssues: findings.length,
        orphanClusters: repairPlan.orphanClusters.length,
        lengthFixes: repairPlan.lengthFixes.length,
      },
    };
  }

  applySafeRepair(report) {
    const scan = report || this.scanIntegrity();
    let freed = 0;
    let fixedLengths = 0;

    for (const rel of scan.repairPlan.orphanClusters) {
      this._setFatEntry(rel, 0);
      freed += 1;
    }
    for (const fix of scan.repairPlan.lengthFixes) {
      this._setEntryLength(fix.parentClusterRel, fix.slotIndex, fix.newLength);
      fixedLengths += 1;
    }
    this._refreshParser();

    return {
      freedClusters: freed,
      fixedLengths,
    };
  }

  deleteEntry(relDirStartCluster, entry) {
    if (!entry || entry.isParentNav || !Number.isFinite(entry.slotIndex)) {
      throw new Error("Invalid entry selection.");
    }

    if (entry.type === "directory") {
      const visibleChildren = this.parser.parseDirectory(
        entry.clusterRel,
        false,
      );
      for (const child of visibleChildren) {
        this.deleteEntry(entry.clusterRel, child);
      }
      this._freeClusterChain(entry.clusterRel);
    } else if (entry.type === "file") {
      if (entry.length > 0 && entry.clusterRel !== FAT.END_OF_CHAIN) {
        this._freeClusterChain(entry.clusterRel);
      }
    } else {
      throw new Error("Only file and directory entries can be deleted.");
    }

    this._writeDirEntryAtSlot(
      relDirStartCluster,
      entry.slotIndex,
      new Uint8Array(DIRENT_SIZE),
    );
    this._adjustDirectoryLength(relDirStartCluster, -1);
    this._syncDirectoryLengthInParent(relDirStartCluster);
    this._refreshParser();
  }
}
