import { DIRENT_SIZE, ENTRY_MODE, FAT, SUPERBLOCK_MAGIC } from "./constants.js";

function createSafeDecoder(labels) {
  for (const label of labels) {
    try {
      return new TextDecoder(label, { fatal: false });
    } catch (_) {
      // Ignore unsupported labels and keep trying fallback labels.
    }
  }
  return new TextDecoder();
}

const SHIFT_JIS_DECODER = createSafeDecoder([
  "shift_jis",
  "sjis",
  "windows-31j",
  "utf-8",
]);
const ASCII_DECODER = createSafeDecoder(["ascii", "utf-8"]);
const LEGACY_SUPERBLOCK_MAGIC = SUPERBLOCK_MAGIC.trimEnd();

function readCString(decoder, bytes) {
  const zeroPos = bytes.indexOf(0x00);
  const payload = zeroPos >= 0 ? bytes.subarray(0, zeroPos) : bytes;
  return decoder.decode(payload).replace(/\u0000/g, "").trim();
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasExactlyOneTypeBit(mode) {
  const hasFile = (mode & ENTRY_MODE.FILE) !== 0;
  const hasDir = (mode & ENTRY_MODE.DIRECTORY) !== 0;
  return (hasFile || hasDir) && !(hasFile && hasDir);
}

function parsePs2Timestamp(bytes) {
  if (bytes.length < 8) return null;
  const second = bytes[1];
  const minute = bytes[2];
  const hour = bytes[3];
  const day = bytes[4];
  const month = bytes[5];
  const year = bytes[6] | (bytes[7] << 8);

  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour: clampInt(hour, 0, 23),
    minute: clampInt(minute, 0, 59),
    second: clampInt(second, 0, 59),
    toString() {
      const p2 = (n) => String(n).padStart(2, "0");
      return `${year}-${p2(month)}-${p2(day)} ${p2(this.hour)}:${
        p2(this.minute)
      }:${p2(this.second)}`;
    },
  };
}

export class Ps2MemoryCardParser {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.bytes = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);

    this.superblock = this._parseSuperblock();
    this.layout = this._detectLayout();
    this.entriesPerCluster = Math.floor(this.superblock.clusterDataSize / 4);
    this.allocatableClusterCount = this._computeAllocatableClusterCount();
    this.clusterWordCache = new Map();
  }

  _parseSuperblock() {
    if (this.bytes.length < 0x200) {
      throw new Error(
        "File is too small to contain a PS2 memory card superblock.",
      );
    }

    const magicRaw = ASCII_DECODER.decode(this.bytes.subarray(0x00, 0x1c))
      .replace(/\u0000+$/g, "");
    const magic = magicRaw.trimEnd();
    if (magicRaw !== SUPERBLOCK_MAGIC && magic !== LEGACY_SUPERBLOCK_MAGIC) {
      throw new Error(
        "Invalid superblock magic. This does not look like a PS2 memory card image.",
      );
    }

    const pageLength = this.view.getUint16(0x28, true);
    const pagesPerCluster = this.view.getUint16(0x2a, true);
    const pagesPerBlock = this.view.getUint16(0x2c, true);
    const clustersPerCard = this.view.getUint32(0x30, true);
    const allocOffset = this.view.getUint32(0x34, true);
    const allocEnd = this.view.getUint32(0x38, true);
    const rootDirCluster = this.view.getUint32(0x3c, true);
    const backupBlock1 = this.view.getUint32(0x40, true);
    const backupBlock2 = this.view.getUint32(0x44, true);
    const ifcList = [];
    for (let i = 0; i < 32; i += 1) {
      ifcList.push(this.view.getUint32(0x50 + i * 4, true));
    }
    const cardType = this.view.getUint8(0x150);
    const cardFlags = this.view.getUint8(0x151);
    const clusterSize = this.view.getUint32(0x154, true);
    const fatEntriesPerCluster = this.view.getUint32(0x158, true);
    const clustersPerBlock = this.view.getUint32(0x15c, true);
    const cardForm = this.view.getInt32(0x160, true);
    const rootDirCluster2 = this.view.getUint32(0x164, true);
    const maxAllocatableClusters = this.view.getUint32(0x170, true);

    if (pageLength === 0 || pagesPerCluster === 0 || clustersPerCard === 0) {
      throw new Error("Superblock contains invalid geometry values.");
    }

    return {
      magic,
      magicRaw,
      pageLength,
      pagesPerCluster,
      pagesPerBlock,
      clustersPerCard,
      allocOffset,
      allocEnd,
      rootDirCluster,
      backupBlock1,
      backupBlock2,
      ifcList,
      cardType,
      cardFlags,
      clusterSize,
      fatEntriesPerCluster,
      clustersPerBlock,
      cardForm,
      rootDirCluster2,
      maxAllocatableClusters,
      clusterDataSize: pageLength * pagesPerCluster,
    };
  }

  _detectLayout() {
    const s = this.superblock;
    const eccBytesPerPage = s.pageLength === 512
      ? 16
      : s.pageLength === 1024
      ? 32
      : Math.ceil(s.pageLength / 128) * 4;
    const candidates = [
      {
        hasEcc: false,
        pagePhysicalSize: s.pageLength,
      },
      {
        hasEcc: true,
        pagePhysicalSize: s.pageLength + eccBytesPerPage,
      },
    ].map((candidate) => {
      const clusterPhysicalSize = candidate.pagePhysicalSize *
        s.pagesPerCluster;
      const expectedSize = clusterPhysicalSize * s.clustersPerCard;
      const delta = Math.abs(this.bytes.length - expectedSize);
      return {
        ...candidate,
        clusterPhysicalSize,
        expectedSize,
        delta,
      };
    });

    const exact = candidates.find((c) => c.expectedSize === this.bytes.length);
    if (exact) return exact;

    candidates.sort((a, b) => a.delta - b.delta);
    return candidates[0];
  }

  _computeAllocatableClusterCount() {
    const maxByGeometry = Math.max(
      0,
      this.superblock.clustersPerCard - this.superblock.allocOffset,
    );
    const bySuperblock = this.superblock.allocEnd;
    const superblockCap = bySuperblock > 0 && bySuperblock <= maxByGeometry
      ? bySuperblock
      : maxByGeometry;
    const byMaxAlloc = this.superblock.maxAllocatableClusters;
    if (byMaxAlloc > 0 && byMaxAlloc <= maxByGeometry) {
      return Math.min(byMaxAlloc, superblockCap);
    }
    return superblockCap;
  }

  getSummary() {
    const usage = this.getUsageStats();
    return {
      magic: this.superblock.magic,
      pageLength: this.superblock.pageLength,
      pagesPerCluster: this.superblock.pagesPerCluster,
      pagesPerBlock: this.superblock.pagesPerBlock,
      clusterDataSize: this.superblock.clusterDataSize,
      clustersPerCard: this.superblock.clustersPerCard,
      allocOffset: this.superblock.allocOffset,
      allocatableClusterCount: this.allocatableClusterCount,
      maxAllocatableClusters: this.superblock.maxAllocatableClusters,
      rootDirCluster: this.superblock.rootDirCluster,
      rootDirCluster2: this.superblock.rootDirCluster2,
      backupBlock1: this.superblock.backupBlock1,
      backupBlock2: this.superblock.backupBlock2,
      cardType: this.superblock.cardType,
      cardFlags: this.superblock.cardFlags,
      hasEcc: this.layout.hasEcc,
      pagePhysicalSize: this.layout.pagePhysicalSize,
      imageSize: this.bytes.length,
      usage,
    };
  }

  getUsageStats() {
    let used = 0;
    let free = 0;
    for (let rel = 0; rel < this.allocatableClusterCount; rel += 1) {
      const v = this.getFatEntry(rel);
      if ((v & FAT.CHAIN_FLAG) !== 0) {
        used += 1;
      } else {
        free += 1;
      }
    }
    return {
      usedClusters: used,
      freeClusters: free,
      usedBytes: used * this.superblock.clusterDataSize,
      freeBytes: free * this.superblock.clusterDataSize,
    };
  }

  _clusterPhysicalOffset(absoluteCluster) {
    return absoluteCluster * this.layout.clusterPhysicalSize;
  }

  _dataClusterToAbsolute(relCluster) {
    return this.superblock.allocOffset + relCluster;
  }

  readClusterDataAbsolute(absoluteCluster) {
    if (
      absoluteCluster < 0 || absoluteCluster >= this.superblock.clustersPerCard
    ) {
      throw new Error(`Cluster index out of range: ${absoluteCluster}`);
    }

    const dst = new Uint8Array(this.superblock.clusterDataSize);
    const start = this._clusterPhysicalOffset(absoluteCluster);
    const end = start + this.layout.clusterPhysicalSize;
    if (end > this.bytes.length) {
      throw new Error(`Cluster ${absoluteCluster} exceeds image size.`);
    }

    for (let page = 0; page < this.superblock.pagesPerCluster; page += 1) {
      const srcOffset = start + page * this.layout.pagePhysicalSize;
      const dstOffset = page * this.superblock.pageLength;
      dst.set(
        this.bytes.subarray(srcOffset, srcOffset + this.superblock.pageLength),
        dstOffset,
      );
    }
    return dst;
  }

  _getClusterWords(absoluteCluster) {
    if (this.clusterWordCache.has(absoluteCluster)) {
      return this.clusterWordCache.get(absoluteCluster);
    }
    const bytes = this.readClusterDataAbsolute(absoluteCluster);
    const out = new Uint32Array(this.entriesPerCluster);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = dv.getUint32(i * 4, true);
    }
    this.clusterWordCache.set(absoluteCluster, out);
    return out;
  }

  getFatEntry(relCluster) {
    if (relCluster < 0 || relCluster >= this.allocatableClusterCount) {
      return 0;
    }

    const fatOffset = relCluster % this.entriesPerCluster;
    const indirectIndex = Math.floor(relCluster / this.entriesPerCluster);
    const indirectOffset = indirectIndex % this.entriesPerCluster;
    const dblIndirectIndex = Math.floor(indirectIndex / this.entriesPerCluster);

    const indirectCluster = this.superblock.ifcList[dblIndirectIndex];
    if (
      !Number.isFinite(indirectCluster) || indirectCluster === 0 ||
      indirectCluster === FAT.END_OF_CHAIN
    ) {
      return 0;
    }

    const indirectWords = this._getClusterWords(indirectCluster);
    const fatCluster = indirectWords[indirectOffset];
    if (
      !Number.isFinite(fatCluster) || fatCluster === 0 ||
      fatCluster === FAT.END_OF_CHAIN
    ) {
      return 0;
    }

    const fatWords = this._getClusterWords(fatCluster);
    return fatWords[fatOffset];
  }

  getClusterChain(relStartCluster) {
    if (relStartCluster === FAT.END_OF_CHAIN) return [];
    const chain = [];
    const seen = new Set();
    let current = relStartCluster;

    while (current !== FAT.END_OF_CHAIN) {
      if (current < 0 || current >= this.allocatableClusterCount) break;
      if (seen.has(current)) break;
      seen.add(current);
      chain.push(current);

      const fatValue = this.getFatEntry(current);
      if (fatValue === FAT.END_OF_CHAIN) break;
      if ((fatValue & FAT.CHAIN_FLAG) === 0) break;
      current = fatValue & ~FAT.CHAIN_FLAG;
    }

    return chain;
  }

  readClusterChainData(relStartCluster, maxBytes = null) {
    const chain = this.getClusterChain(relStartCluster);
    if (chain.length === 0) return new Uint8Array(0);

    const chunkSize = this.superblock.clusterDataSize;
    const out = new Uint8Array(chain.length * chunkSize);
    let offset = 0;
    for (const relCluster of chain) {
      const absCluster = this._dataClusterToAbsolute(relCluster);
      const chunk = this.readClusterDataAbsolute(absCluster);
      out.set(chunk, offset);
      offset += chunk.length;
    }
    if (Number.isFinite(maxBytes) && maxBytes >= 0 && maxBytes < out.length) {
      return out.subarray(0, maxBytes);
    }
    return out;
  }

  parseDirectory(relStartCluster, includeSpecialEntries = false) {
    const data = this.readClusterChainData(relStartCluster);
    const entries = [];
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = Math.floor(data.length / DIRENT_SIZE);

    for (let i = 0; i < count; i += 1) {
      const base = i * DIRENT_SIZE;
      const mode = dv.getUint16(base + 0x00, true);
      if ((mode & ENTRY_MODE.EXISTS) === 0) continue;
      if (mode === 0xffff) continue;

      const name = readCString(
        SHIFT_JIS_DECODER,
        data.subarray(base + 0x40, base + 0x60),
      );
      if (!name) continue;
      if (!includeSpecialEntries && (name === "." || name === "..")) continue;

      const length = dv.getUint32(base + 0x04, true);
      const clusterRel = dv.getUint32(base + 0x10, true);
      const entryIndex = dv.getUint32(base + 0x14, true);
      const attr = dv.getUint32(base + 0x20, true);
      const looksErased = length === 0xffffffff &&
        clusterRel === 0xffffffff &&
        entryIndex === 0xffffffff &&
        attr === 0xffffffff;
      if (looksErased) continue;

      const created = parsePs2Timestamp(
        data.subarray(base + 0x08, base + 0x10),
      );
      const modified = parsePs2Timestamp(
        data.subarray(base + 0x18, base + 0x20),
      );

      let type = "unknown";
      if ((mode & ENTRY_MODE.DIRECTORY) !== 0) {
        type = "directory";
      } else if ((mode & ENTRY_MODE.FILE) !== 0) {
        type = "file";
      }
      if (!hasExactlyOneTypeBit(mode)) continue;
      if (!includeSpecialEntries && type === "unknown") continue;

      const maxClusters = this.allocatableClusterCount;
      const maxImageBytes = maxClusters * this.superblock.clusterDataSize;
      const maxDirEntries = Math.max(
        0,
        Math.floor(maxImageBytes / DIRENT_SIZE),
      );
      const hasValidCluster = clusterRel === FAT.END_OF_CHAIN ||
        clusterRel < maxClusters;
      if (!hasValidCluster) continue;
      if (length > maxImageBytes) continue;
      if (entryIndex > maxDirEntries) continue;
      if (type === "directory" && clusterRel === FAT.END_OF_CHAIN) continue;
      if (type === "file" && length > 0 && clusterRel === FAT.END_OF_CHAIN) {
        continue;
      }

      entries.push({
        slotIndex: i,
        name,
        type,
        mode,
        length,
        clusterRel,
        entryIndex,
        attr,
        created,
        modified,
      });
    }

    entries.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  readFileData(entry) {
    if (!entry || entry.type !== "file") {
      throw new Error("readFileData expects a file entry.");
    }
    return this.readClusterChainData(entry.clusterRel, entry.length);
  }
}
