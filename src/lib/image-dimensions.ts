import { LIMITS } from './model';

export function imageDimensions(bytes: Uint8Array): { width: number; height: number; format: 'png' | 'jpg' | 'webp' } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0; let format: 'png' | 'jpg' | 'webp';
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    format = 'png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    format = 'jpg';
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += size;
    }
  } else if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    format = 'webp';
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 0x5650384c && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
  } else throw new Error('Unsupported image. Choose a JPEG, PNG, or WebP file.');
  if (!width || !height) throw new Error('This image has an unreadable header. Export it as JPEG or PNG and try again.');
  if (width * height > LIMITS.imagePixels || width > 16000 || height > 16000) {
    throw new Error('Each image must be at most 16 megapixels and 16,000 pixels per side.');
  }
  return { width, height, format };
}
