
// UF2:
const UF2_MAGIC_START0 = 0x0A324655;
const UF2_MAGIC_START1 = 0x9E5D5157;
const UF2_MAGIC_END = 0x0AB16F30;
const UF2_BLOCK_SIZE = 512;
const UF2_PAYLOAD_SIZE = 256;
const UF2_FAMILY_ID = 0xe48bff56;
const UF2_BASE_ADDR = 0x10800000;
const MAX_FILE_SIZE = 16576512;


function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    throw new Error("Expected an ArrayBuffer or typed array.");
}

function validateUf2ArrayBuffer(data) {
    let buffer;
    try {
        buffer = toArrayBuffer(data);
    } catch (err) {
        return { valid: false, error: err.message };
    }

    if (buffer.byteLength === 0) {
        return { valid: false, error: "UF2 file is empty." };
    }
    if (buffer.byteLength % UF2_BLOCK_SIZE !== 0) {
        return { valid: false, error: "UF2 size is not aligned to 512-byte blocks." };
    }

    const view = new DataView(buffer);
    const numBlocks = buffer.byteLength / UF2_BLOCK_SIZE;
    for (let blockNum = 0; blockNum < numBlocks; ++blockNum) {
        const ptr = blockNum * UF2_BLOCK_SIZE;
        const start0 = view.getUint32(ptr + 0, true);
        const start1 = view.getUint32(ptr + 4, true);
        const end = view.getUint32(ptr + UF2_BLOCK_SIZE - 4, true);
        if (start0 !== UF2_MAGIC_START0 || start1 !== UF2_MAGIC_START1 || end !== UF2_MAGIC_END) {
            return { valid: false, error: `Invalid UF2 magic in block ${blockNum}.` };
        }
    }

    return { valid: true, buffer: buffer, numBlocks: numBlocks };
}

function payloadToUf2(arrayBuffer) {
    // Add a terminating 0x00 after the end of the arrayBuffer
    const sourceBuffer = toArrayBuffer(arrayBuffer);
    const origData = new Uint8Array(sourceBuffer);
    if (origData.length > MAX_FILE_SIZE) {
        throw new Error("Payload exceeds maximum UF2 file size.");
    }
    const data = new Uint8Array(origData.length + 1);
    data.set(origData, 0);
    data[data.length - 1] = 0x00;

    const numBlocks = Math.ceil(data.length / UF2_PAYLOAD_SIZE);
    const uf2 = new Uint8Array(numBlocks * UF2_BLOCK_SIZE);

    for (let blockNum = 0; blockNum < numBlocks; ++blockNum) {
        const ptr = blockNum * UF2_BLOCK_SIZE;
        const payload = data.subarray(blockNum * UF2_PAYLOAD_SIZE, (blockNum + 1) * UF2_PAYLOAD_SIZE);

        const view = new DataView(uf2.buffer, ptr, UF2_BLOCK_SIZE);
        view.setUint32(0, UF2_MAGIC_START0, true);
        view.setUint32(4, UF2_MAGIC_START1, true);
        view.setUint32(8, 0x00002000, true);
        view.setUint32(12, UF2_BASE_ADDR + blockNum * UF2_PAYLOAD_SIZE, true);
        view.setUint32(16, UF2_PAYLOAD_SIZE, true);
        view.setUint32(20, blockNum, true);
        view.setUint32(24, numBlocks, true);
        view.setUint32(28, UF2_FAMILY_ID, true);
        uf2.set(payload, ptr + 32);
        for (let i = payload.length; i < UF2_PAYLOAD_SIZE; ++i) {
            uf2[ptr + 32 + i] = 0;
        }
        view.setUint32(512 - 4, UF2_MAGIC_END, true);
    }
    return uf2;
}

function mergeUf2Files(uf2_1, uf2_2) {
    const firstValidation = validateUf2ArrayBuffer(uf2_1);
    if (!firstValidation.valid) {
        throw new Error(`First UF2 is invalid: ${firstValidation.error}`);
    }
    const secondValidation = validateUf2ArrayBuffer(uf2_2);
    if (!secondValidation.valid) {
        throw new Error(`Second UF2 is invalid: ${secondValidation.error}`);
    }

    const first = firstValidation.buffer;
    const second = secondValidation.buffer;
    const totalSize = first.byteLength + second.byteLength;
    const mergedUf2 = new Uint8Array(totalSize);
    mergedUf2.set(new Uint8Array(first), 0);
    mergedUf2.set(new Uint8Array(second), first.byteLength);

    const numBlocks = mergedUf2.length / UF2_BLOCK_SIZE;

    for (let blockNum = 0; blockNum < numBlocks; ++blockNum) {
        const ptr = blockNum * UF2_BLOCK_SIZE;

        const view = new DataView(mergedUf2.buffer, ptr, UF2_BLOCK_SIZE);
        view.setUint32(20, blockNum, true);
        view.setUint32(24, numBlocks, true);
    }

    return mergedUf2;
}
