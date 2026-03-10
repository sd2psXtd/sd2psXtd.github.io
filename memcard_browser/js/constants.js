export const SUPERBLOCK_MAGIC = "Sony PS2 Memory Card Format ";
export const DIRENT_SIZE = 0x200;

export const ENTRY_MODE = {
  READ: 0x0001,
  WRITE: 0x0002,
  EXECUTE: 0x0004,
  PROTECTED: 0x0008,
  FILE: 0x0010,
  DIRECTORY: 0x0020,
  DUPLICATE: 0x0040,
  FILE_EXTRA: 0x0080,
  HIDDEN: 0x2000,
  PS2_VALID: 0x0400,
  EXISTS: 0x8000,
};

export const FAT = {
  CHAIN_FLAG: 0x80000000,
  END_OF_CHAIN: 0xffffffff,
};

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "n/a";
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB"];
  let n = value;
  let idx = -1;
  do {
    n /= 1024;
    idx += 1;
  } while (n >= 1024 && idx < units.length - 1);
  return `${n.toFixed(n >= 10 ? 1 : 2)} ${units[idx]}`;
}

export function formatHex(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `0x${value.toString(16).toUpperCase()}`;
}
