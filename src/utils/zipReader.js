import { Inflate } from 'fflate';

/**
 * Minimal streaming ZIP reader over a Blob / File.
 *
 * Unlike JSZip.loadAsync (which reads the whole archive into memory), this
 * reads only the central directory up front and then the byte range of each
 * entry on demand, inflating it chunk by chunk. That keeps memory flat for
 * multi-gigabyte exports (an Apple Health `export.xml` can exceed 4 GB) and
 * makes parsing them feasible on phones.
 *
 * Supports stored (0) and deflate (8) entries and ZIP64 archives. Encrypted
 * entries are rejected.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

const CHUNK_SIZE = 4 * 1024 * 1024;
// fflate inflates each push in one go and emits it as a single chunk, so
// compressed input is fed in small pieces: XML compresses ~10-30x, and a 4 MB
// push would surface as one ~100 MB string.
const INFLATE_PIECE = 64 * 1024;

/**
 * Read a byte range of a Blob as a Uint8Array. Falls back to FileReader for
 * environments without Blob#arrayBuffer (older browsers, jsdom).
 * @param {Blob} blob
 * @param {number} start
 * @param {number} end
 * @returns {Promise<Uint8Array>}
 */
export const readSlice = (blob, start, end) => {
  const part = blob.slice(start, end);
  if (typeof part.arrayBuffer === 'function') {
    return part.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(part);
  });
};

/** Little-endian 64-bit read (safe up to 2^53). */
const getUint64 = (view, offset) =>
  view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x100000000;

const utf8 = new TextDecoder('utf-8');

/**
 * True when the blob starts with a ZIP signature.
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export const isZip = async (blob) => {
  if (!blob || blob.size < 4) return false;
  const head = await readSlice(blob, 0, 4);
  return head[0] === 0x50 && head[1] === 0x4b
    && ((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6));
};

/**
 * Locate and parse the end-of-central-directory record (ZIP64 aware).
 * @param {Blob} blob
 * @returns {Promise<{count: number, cdOffset: number, cdSize: number}>}
 */
const readEndOfCentralDirectory = async (blob) => {
  // EOCD is 22 bytes plus an optional comment of up to 65535 bytes.
  const tailLen = Math.min(blob.size, 22 + 65535 + 20);
  const tailStart = blob.size - tailLen;
  const tail = await readSlice(blob, tailStart, blob.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let pos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      pos = i;
      break;
    }
  }
  if (pos < 0) throw new Error('Not a ZIP file (no end of central directory found)');

  let count = view.getUint16(pos + 10, true);
  let cdSize = view.getUint32(pos + 12, true);
  let cdOffset = view.getUint32(pos + 16, true);

  const needs64 = count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  const locPos = pos - 20;
  if (locPos >= 0 && view.getUint32(locPos, true) === SIG_EOCD64_LOCATOR) {
    const eocd64Offset = getUint64(view, locPos + 8);
    const rec = await readSlice(blob, eocd64Offset, eocd64Offset + 56);
    const v64 = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    if (v64.getUint32(0, true) === SIG_EOCD64) {
      count = getUint64(v64, 32);
      cdSize = getUint64(v64, 40);
      cdOffset = getUint64(v64, 48);
    }
  } else if (needs64) {
    throw new Error('ZIP64 archive is missing its end-of-central-directory locator');
  }

  return { count, cdOffset, cdSize };
};

/**
 * Parse the central directory into entry descriptors.
 * @param {Blob} blob
 * @returns {Promise<Object[]>}
 */
const readCentralDirectory = async (blob) => {
  const { count, cdOffset, cdSize } = await readEndOfCentralDirectory(blob);
  const cd = await readSlice(blob, cdOffset, cdOffset + cdSize);
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localOffset = view.getUint32(p + 42, true);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 extended information extra field (0x0001): present values appear
    // in a fixed order, only for fields whose 32-bit slot is saturated.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = view.getUint16(e, true);
      const len = view.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = getUint64(view, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = getUint64(view, q); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = getUint64(view, q); }
      }
      e += 4 + len;
    }

    entries.push({
      name,
      dir: name.endsWith('/'),
      method,
      encrypted: (flags & 1) === 1,
      compressedSize,
      size,
      localOffset,
    });
    p = extraEnd + commentLen;
  }
  return entries;
};

/**
 * Offset of an entry's compressed data (after its local header).
 * @param {Blob} blob
 * @param {Object} entry
 * @returns {Promise<number>}
 */
const dataOffset = async (blob, entry) => {
  const head = await readSlice(blob, entry.localOffset, entry.localOffset + 30);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== SIG_LOCAL) {
    throw new Error(`Corrupt ZIP: bad local header for ${entry.name}`);
  }
  return entry.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
};

/**
 * Open a ZIP archive.
 * @param {Blob} blob
 * @returns {Promise<{entries: Object[], stream: Function, readBytes: Function, readText: Function, streamText: Function}>}
 */
export async function openZip(blob) {
  const entries = (await readCentralDirectory(blob)).filter((e) => !e.dir);

  /**
   * Stream an entry's uncompressed bytes.
   * @param {Object} entry
   * @param {(chunk: Uint8Array) => void} onData
   * @param {(fraction: number) => void} [onProgress]
   */
  const stream = async (entry, onData, onProgress) => {
    if (entry.encrypted) throw new Error(`${entry.name} is encrypted`);
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`${entry.name} uses unsupported compression method ${entry.method}`);
    }
    const start = await dataOffset(blob, entry);
    const end = start + entry.compressedSize;
    const inflater = entry.method === 8 ? new Inflate((chunk) => onData(chunk)) : null;

    if (entry.compressedSize === 0) {
      if (inflater) inflater.push(new Uint8Array(0), true);
      return;
    }
    for (let pos = start; pos < end; pos += CHUNK_SIZE) {
      const stop = Math.min(end, pos + CHUNK_SIZE);
      const chunk = await readSlice(blob, pos, stop);
      if (inflater) {
        for (let off = 0; off < chunk.length; off += INFLATE_PIECE) {
          const pieceEnd = Math.min(chunk.length, off + INFLATE_PIECE);
          inflater.push(chunk.subarray(off, pieceEnd), stop === end && pieceEnd === chunk.length);
        }
      } else onData(chunk);
      if (onProgress) onProgress((stop - start) / entry.compressedSize);
    }
  };

  const readBytes = async (entry) => {
    const parts = [];
    let total = 0;
    await stream(entry, (c) => { parts.push(c); total += c.length; });
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of parts) { out.set(c, off); off += c.length; }
    return out;
  };

  const readText = async (entry) => utf8.decode(await readBytes(entry));

  /**
   * Stream an entry as decoded UTF-8 text chunks.
   * @param {Object} entry
   * @param {(text: string) => void} onText
   * @param {(fraction: number) => void} [onProgress]
   */
  const streamText = async (entry, onText, onProgress) => {
    const decoder = new TextDecoder('utf-8');
    await stream(entry, (c) => onText(decoder.decode(c, { stream: true })), onProgress);
    const rest = decoder.decode();
    if (rest) onText(rest);
  };

  return { entries, stream, readBytes, readText, streamText };
}

/**
 * Stream a plain (non-zipped) Blob as decoded UTF-8 text chunks.
 * @param {Blob} blob
 * @param {(text: string) => void} onText
 * @param {(fraction: number) => void} [onProgress]
 */
export async function streamBlobText(blob, onText, onProgress) {
  const decoder = new TextDecoder('utf-8');
  for (let pos = 0; pos < blob.size; pos += CHUNK_SIZE) {
    const stop = Math.min(blob.size, pos + CHUNK_SIZE);
    onText(decoder.decode(await readSlice(blob, pos, stop), { stream: true }));
    if (onProgress) onProgress(stop / blob.size);
  }
  const rest = decoder.decode();
  if (rest) onText(rest);
}
