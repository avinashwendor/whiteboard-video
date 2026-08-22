/**
 * Reads pixel dimensions straight from the file header.
 *
 * Providers do not always honour the size you ask for -- Pollinations happily
 * returns 1024x576 for a 1280x720 request -- so the metadata shown to the user
 * comes from the bytes rather than from the request.
 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readWebp(bytes);
}

function readPng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => b[index] !== value)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1];
    // SOF0-SOF15, excluding the non-frame markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function readGif(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 10 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readWebp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  const format = String.fromCharCode(b[8], b[9], b[10], b[11]);
  if (tag !== "RIFF" || format !== "WEBP") return null;

  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  if (chunk === "VP8X") {
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}
