function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const second = Math.floor(d.getSeconds() / 2);
  const dosTime = ((hour & 0x1f) << 11) | ((minute & 0x3f) << 5) |
    (second & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) |
    (day & 0x1f);
  return { dosTime, dosDate };
}

function concatArrays(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readUint32(view, offset) {
  return view.getUint32(offset, true);
}

async function inflateZipData(deflatedBytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "ZIP deflate entries are unsupported in this browser (no DecompressionStream).",
    );
  }

  const methods = ["deflate-raw", "deflate"];
  let lastErr = null;
  for (const method of methods) {
    try {
      const ds = new DecompressionStream(method);
      const stream = new Blob([deflatedBytes]).stream().pipeThrough(ds);
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not inflate ZIP data.");
}

export function createZipBlob(entries) {
  const now = new Date();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  let localTotal = 0;

  for (const src of entries) {
    const isDirectory = src.isDirectory === true;
    const normalizedPath = String(src.path || "").replace(/\\/g, "/");
    const path = isDirectory
      ? (normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`)
      : normalizedPath;
    const nameBytes = UTF8.encode(path);
    const data = isDirectory
      ? new Uint8Array(0)
      : (src.data instanceof Uint8Array
        ? src.data
        : new Uint8Array(src.data || 0));
    const dataCrc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(now);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0x00, 0x04034b50, true);
    localView.setUint16(0x04, 20, true);
    localView.setUint16(0x06, 0x0800, true); // UTF-8 names
    localView.setUint16(0x08, 0, true); // store
    localView.setUint16(0x0a, dosTime, true);
    localView.setUint16(0x0c, dosDate, true);
    localView.setUint32(0x0e, dataCrc, true);
    localView.setUint32(0x12, data.length, true);
    localView.setUint32(0x16, data.length, true);
    localView.setUint16(0x1a, nameBytes.length, true);
    localView.setUint16(0x1c, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local);
    localChunks.push(data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cView = new DataView(central.buffer);
    cView.setUint32(0x00, 0x02014b50, true);
    cView.setUint16(0x04, 20, true);
    cView.setUint16(0x06, 20, true);
    cView.setUint16(0x08, 0x0800, true);
    cView.setUint16(0x0a, 0, true);
    cView.setUint16(0x0c, dosTime, true);
    cView.setUint16(0x0e, dosDate, true);
    cView.setUint32(0x10, dataCrc, true);
    cView.setUint32(0x14, data.length, true);
    cView.setUint32(0x18, data.length, true);
    cView.setUint16(0x1c, nameBytes.length, true);
    cView.setUint16(0x1e, 0, true);
    cView.setUint16(0x20, 0, true);
    cView.setUint16(0x22, 0, true);
    cView.setUint16(0x24, 0, true);
    cView.setUint32(0x26, isDirectory ? 0x10 : 0x20, true);
    cView.setUint32(0x2a, localOffset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    localOffset += local.length + data.length;
    localTotal += local.length + data.length;
  }

  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0x00, 0x06054b50, true);
  endView.setUint16(0x04, 0, true);
  endView.setUint16(0x06, 0, true);
  endView.setUint16(0x08, centralChunks.length, true);
  endView.setUint16(0x0a, centralChunks.length, true);
  endView.setUint32(0x0c, centralSize, true);
  endView.setUint32(0x10, localTotal, true);
  endView.setUint16(0x14, 0, true);

  const total = localTotal + centralSize + end.length;
  const out = concatArrays([...localChunks, ...centralChunks, end], total);
  return new Blob([out], { type: "application/zip" });
}

export async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= searchStart; i -= 1) {
    if (readUint32(view, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("ZIP end-of-central-directory record not found.");
  }

  const totalEntries = view.getUint16(eocdOffset + 0x0a, true);
  const centralOffset = readUint32(view, eocdOffset + 0x10);
  let offset = centralOffset;
  const out = [];

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry.");
    }
    const flags = view.getUint16(offset + 0x08, true);
    const method = view.getUint16(offset + 0x0a, true);
    const compressedSize = readUint32(view, offset + 0x14);
    const uncompressedSize = readUint32(view, offset + 0x18);
    const fileNameLen = view.getUint16(offset + 0x1c, true);
    const extraLen = view.getUint16(offset + 0x1e, true);
    const commentLen = view.getUint16(offset + 0x20, true);
    const localHeaderOffset = readUint32(view, offset + 0x2a);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLen);
    const path = UTF8_DECODER.decode(nameBytes);

    if ((flags & 0x0001) !== 0) {
      throw new Error("Encrypted ZIP entries are unsupported.");
    }

    const isDirectory = path.endsWith("/");
    if (isDirectory) {
      out.push({ path, isDirectory: true, data: new Uint8Array(0) });
      offset += 46 + fileNameLen + extraLen + commentLen;
      continue;
    }

    if (readUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${path}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 0x1a, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 0x1c, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) {
      data = new Uint8Array(compressed);
    } else if (method === 8) {
      data = await inflateZipData(compressed);
    } else {
      throw new Error(
        `Unsupported ZIP compression method ${method} for ${path}`,
      );
    }
    if (Number.isFinite(uncompressedSize) && data.length !== uncompressedSize) {
      throw new Error(`ZIP size mismatch for ${path}`);
    }
    out.push({ path, isDirectory: false, data });
    offset += 46 + fileNameLen + extraLen + commentLen;
  }
  return out;
}
