import { DIRENT_SIZE, ENTRY_MODE, FAT, SUPERBLOCK_MAGIC } from "./constants.js";

const PAGE_LENGTH = 512;
const PAGES_PER_CLUSTER = 2;
const PAGES_PER_BLOCK = 16;
const IFC_LIST_COUNT = 32;
const RESERVED_TAIL_CLUSTERS = 16;
const SUPERBLOCK_VERSION = "1.2.0.0";
const CARD_TYPE_PS2 = 2;
const CARD_FLAGS_DEFAULT = 0x2b;
const FAT_FREE_ENTRY = 0x7fffffff;

const MODE_DIRECTORY_DEFAULT = ENTRY_MODE.EXISTS | ENTRY_MODE.DIRECTORY |
  ENTRY_MODE.READ | ENTRY_MODE.WRITE | ENTRY_MODE.EXECUTE |
  ENTRY_MODE.PS2_VALID;
const MODE_ROOT_PARENT = ENTRY_MODE.EXISTS | ENTRY_MODE.DIRECTORY |
  ENTRY_MODE.WRITE | ENTRY_MODE.EXECUTE | ENTRY_MODE.PS2_VALID |
  ENTRY_MODE.HIDDEN;

function writeCString(bytes, offset, length, text) {
  const encoded = new TextEncoder().encode(text);
  const n = Math.min(length - 1, encoded.length);
  bytes.fill(0, offset, offset + length);
  bytes.set(encoded.subarray(0, n), offset);
}

function writeFixedString(bytes, offset, length, text) {
  const encoded = new TextEncoder().encode(text);
  const n = Math.min(length, encoded.length);
  bytes.fill(0, offset, offset + length);
  bytes.set(encoded.subarray(0, n), offset);
}

function writeTimestamp(out, dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  out[0] = 0;
  out[1] = d.getSeconds() & 0xff;
  out[2] = d.getMinutes() & 0xff;
  out[3] = d.getHours() & 0xff;
  out[4] = d.getDate() & 0xff;
  out[5] = (d.getMonth() + 1) & 0xff;
  const year = d.getFullYear() & 0xffff;
  out[6] = year & 0xff;
  out[7] = (year >> 8) & 0xff;
}

function buildDirEntry({
  name,
  mode,
  length,
  clusterRel,
  entryIndex = 0,
  attr = 0,
  created,
  modified,
}) {
  const out = new Uint8Array(DIRENT_SIZE);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint16(0x00, mode >>> 0, true);
  dv.setUint16(0x02, 0, true);
  dv.setUint32(0x04, length >>> 0, true);
  const tsCreated = new Uint8Array(8);
  writeTimestamp(tsCreated, created);
  out.set(tsCreated, 0x08);
  dv.setUint32(0x10, clusterRel >>> 0, true);
  dv.setUint32(0x14, entryIndex >>> 0, true);
  const tsModified = new Uint8Array(8);
  writeTimestamp(tsModified, modified || created);
  out.set(tsModified, 0x18);
  dv.setUint32(0x20, attr >>> 0, true);
  writeCString(out, 0x40, 0x20, name);
  return out;
}

function getSizePreset(sizeMb) {
  const supported = [1, 2, 4, 8, 16, 32, 64];
  if (!supported.includes(sizeMb)) {
    throw new Error(`Unsupported card size: ${sizeMb} MB`);
  }
  return {
    sizeBytes: sizeMb * 1024 * 1024,
    ifcFirstCluster: sizeMb >= 8 ? 16 : 8,
  };
}

function resolveFatLayout({
  clustersPerCard,
  ifcFirstCluster,
  entriesPerCluster,
}) {
  let fatClusters = 1;
  let ifcClusters = 1;
  let allocOffset = 0;
  let allocEnd = 0;

  for (let i = 0; i < 16; i += 1) {
    ifcClusters = Math.max(1, Math.ceil(fatClusters / entriesPerCluster));
    allocOffset = ifcFirstCluster + ifcClusters + fatClusters;
    allocEnd = clustersPerCard - allocOffset - RESERVED_TAIL_CLUSTERS;
    if (allocEnd <= 0) {
      throw new Error("Card geometry is too small for filesystem metadata.");
    }
    const nextFatClusters = Math.ceil(allocEnd / entriesPerCluster);
    if (nextFatClusters === fatClusters) break;
    fatClusters = nextFatClusters;
  }

  ifcClusters = Math.max(1, Math.ceil(fatClusters / entriesPerCluster));
  allocOffset = ifcFirstCluster + ifcClusters + fatClusters;
  allocEnd = clustersPerCard - allocOffset - RESERVED_TAIL_CLUSTERS;
  return {
    ifcClusters,
    fatClusters,
    fatStartAbs: ifcFirstCluster + ifcClusters,
    allocOffset,
    allocEnd,
  };
}

function calcTargetAllocatableClusters(clustersPerCard) {
  const product = BigInt(clustersPerCard) * 0x10624dd3n;
  const hi = Number((product >> 32n) & 0xffffffffn);
  const temp = (hi >>> 6) - (clustersPerCard >>> 31);
  return (((((temp << 5) - temp) << 2) + temp) << 3) + 1;
}

function calcMaxAllocatableClusters({
  clustersPerCard,
  allocOffset,
  backupBlock2,
  clustersPerBlock,
  badBlocks,
}) {
  const target = calcTargetAllocatableClusters(clustersPerCard);
  const endAbsCluster = backupBlock2 * clustersPerBlock;
  let seenGood = 0;
  let maxAllocatable = 0;

  for (
    let clusterAbs = allocOffset;
    clusterAbs < endAbsCluster;
    clusterAbs += 1
  ) {
    const block = Math.floor(clusterAbs / clustersPerBlock);
    const isBad = badBlocks.some((badBlock) =>
      badBlock >= 0 && badBlock === block
    );
    if (isBad) continue;

    seenGood += 1;
    if (maxAllocatable === 0 && seenGood === target) {
      maxAllocatable = (clusterAbs - allocOffset) + 1;
    }
  }

  if (maxAllocatable === 0) {
    return endAbsCluster;
  }
  return maxAllocatable;
}

export function createEmptyPs2CardImage({ sizeMb = 8 } = {}) {
  const preset = getSizePreset(sizeMb);
  const bytes = new Uint8Array(preset.sizeBytes);
  bytes.fill(0xff);
  const view = new DataView(bytes.buffer);
  const clusterDataSize = PAGE_LENGTH * PAGES_PER_CLUSTER;
  const clustersPerCard = Math.floor(preset.sizeBytes / clusterDataSize);
  const entriesPerCluster = Math.floor(clusterDataSize / 4);
  const clustersPerBlock = Math.floor(PAGES_PER_BLOCK / PAGES_PER_CLUSTER);
  const rootDirCluster = 0;

  const layout = resolveFatLayout({
    clustersPerCard,
    ifcFirstCluster: preset.ifcFirstCluster,
    entriesPerCluster,
  });

  const blocksOnCard = Math.floor(clustersPerCard / clustersPerBlock);
  const backupBlock1 = blocksOnCard - 1;
  const backupBlock2 = blocksOnCard - 2;
  const allocEnd = (backupBlock2 * clustersPerBlock) - layout.allocOffset;

  const badBlockList = Array(IFC_LIST_COUNT).fill(-1);
  const maxAllocatableClusters = calcMaxAllocatableClusters({
    clustersPerCard,
    allocOffset: layout.allocOffset,
    backupBlock2,
    clustersPerBlock,
    badBlocks: badBlockList.slice(0, 16),
  });

  writeFixedString(bytes, 0x00, 0x1c, SUPERBLOCK_MAGIC);
  writeFixedString(bytes, 0x1c, 0x0c, SUPERBLOCK_VERSION);
  view.setUint16(0x28, PAGE_LENGTH, true);
  view.setUint16(0x2a, PAGES_PER_CLUSTER, true);
  view.setUint16(0x2c, PAGES_PER_BLOCK, true);
  view.setUint16(0x2e, 0xff00, true);
  view.setUint32(0x30, clustersPerCard, true);
  view.setUint32(0x34, layout.allocOffset, true);
  view.setUint32(0x38, allocEnd, true);
  view.setUint32(0x3c, rootDirCluster, true);
  view.setUint32(0x40, backupBlock1, true);
  view.setUint32(0x44, backupBlock2, true);
  bytes.fill(0, 0x48, 0x50);
  for (let i = 0; i < IFC_LIST_COUNT; i += 1) {
    const ifcAbs = i < layout.ifcClusters ? preset.ifcFirstCluster + i : 0;
    view.setUint32(0x50 + i * 4, ifcAbs >>> 0, true);
  }
  for (let i = 0; i < IFC_LIST_COUNT; i += 1) {
    view.setUint32(0xd0 + i * 4, 0xffffffff, true);
  }
  view.setUint8(0x150, CARD_TYPE_PS2);
  view.setUint8(0x151, CARD_FLAGS_DEFAULT);
  view.setUint16(0x152, 0, true);
  view.setUint32(0x154, clusterDataSize, true);
  view.setUint32(0x158, entriesPerCluster, true);
  view.setUint32(0x15c, clustersPerBlock, true);
  view.setInt32(0x160, -1, true);
  view.setUint32(0x164, rootDirCluster, true);
  view.setUint32(0x168, 0, true);
  view.setUint32(0x16c, 0, true);
  view.setUint32(0x170, maxAllocatableClusters, true);
  view.setUint32(0x174, 0, true);
  view.setUint32(0x178, 0, true);
  view.setInt32(0x17c, -1, true);

  const setClusterData = (absCluster, clusterBytes) => {
    const start = absCluster * clusterDataSize;
    bytes.set(clusterBytes, start);
  };

  for (let i = 0; i < layout.ifcClusters; i += 1) {
    const ifcData = new Uint8Array(clusterDataSize);
    const ifcView = new DataView(ifcData.buffer);
    for (let j = 0; j < entriesPerCluster; j += 1) {
      const fatIndex = i * entriesPerCluster + j;
      if (fatIndex >= layout.fatClusters) break;
      ifcView.setUint32(j * 4, layout.fatStartAbs + fatIndex, true);
    }
    setClusterData(preset.ifcFirstCluster + i, ifcData);
  }

  const fatClustersData = Array.from(
    { length: layout.fatClusters },
    () => new Uint8Array(clusterDataSize),
  );
  for (let rel = 0; rel < allocEnd; rel += 1) {
    const fatClusterIndex = Math.floor(rel / entriesPerCluster);
    const fatOffset = rel % entriesPerCluster;
    const fatValue = rel === 0 ? FAT.END_OF_CHAIN : FAT_FREE_ENTRY;
    const fatView = new DataView(fatClustersData[fatClusterIndex].buffer);
    fatView.setUint32(fatOffset * 4, fatValue >>> 0, true);
  }
  for (let i = 0; i < layout.fatClusters; i += 1) {
    setClusterData(layout.fatStartAbs + i, fatClustersData[i]);
  }

  const rootClusterAbs = layout.allocOffset + rootDirCluster;
  const rootData = new Uint8Array(clusterDataSize);
  const now = new Date();
  rootData.set(
    buildDirEntry({
      name: ".",
      mode: MODE_DIRECTORY_DEFAULT,
      length: 2,
      clusterRel: rootDirCluster,
      entryIndex: 0,
      created: now,
      modified: now,
    }),
    0,
  );
  rootData.set(
    buildDirEntry({
      name: "..",
      mode: MODE_ROOT_PARENT,
      length: 0,
      clusterRel: rootDirCluster,
      entryIndex: 0,
      created: now,
      modified: now,
    }),
    DIRENT_SIZE,
  );
  setClusterData(rootClusterAbs, rootData);

  return bytes.buffer;
}
