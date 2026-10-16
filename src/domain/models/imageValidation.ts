export const SKETCH_MAX_BYTES = 10 * 1024 * 1024;
export const SKETCH_MAX_DIMENSION = 8192;
export const SKETCH_MAX_PIXELS = 16 * 1024 * 1024;
const invalid = (): never => { throw new Error('El contenido no coincide con el tipo de imagen.'); };

/** Read bounded headers before an image decoder can allocate its pixel buffer. */
export function inspectImage(bytes: Uint8Array, mime: string, { maxDimension = SKETCH_MAX_DIMENSION, maxPixels = SKETCH_MAX_PIXELS, maxBytes = SKETCH_MAX_BYTES } = {}) {
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, text: string) => [...text].every((character, index) => bytes[start + index] === character.charCodeAt(0));
  let width = 0, height = 0;
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte) || view.getUint32(8) !== 13 || !ascii(12, 'IHDR')) invalid();
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) invalid();
    let position = 2;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 255) invalid();
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (position + 2 > bytes.length) invalid();
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length) invalid();
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8) invalid();
        height = view.getUint16(position + 3); width = view.getUint16(position + 5); break;
      }
      position += length;
    }
  } else if (mime === 'image/webp') {
    if (bytes.length < 20 || !ascii(0, 'RIFF') || !ascii(8, 'WEBP') || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let position = 12, imageSeen = false, canvas: { width: number; height: number } | undefined;
    while (position + 8 <= bytes.length) {
      const length = view.getUint32(position + 4, true), start = position + 8;
      if (start + length > bytes.length) invalid();
      if (ascii(position, 'VP8X')) {
        if (length !== 10 || canvas || imageSeen || bytes[start] & 2) invalid();
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
        canvas = { width, height };
      } else if (ascii(position, 'VP8 ')) {
        if (imageSeen || length < 10 || ![157,1,42].every((byte, index) => bytes[start + 3 + index] === byte)) invalid();
        imageSeen = true;
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
        if (canvas && (canvas.width !== width || canvas.height !== height)) invalid();
      } else if (ascii(position, 'VP8L')) {
        if (imageSeen || length < 5 || bytes[start] !== 47) invalid();
        imageSeen = true;
        const packed = view.getUint32(start + 1, true);
        width = 1 + (packed & 0x3fff); height = 1 + ((packed >>> 14) & 0x3fff);
        if (canvas && (canvas.width !== width || canvas.height !== height)) invalid();
      }
      position = start + length + (length % 2);
    }
  } else invalid();
  if (!width || !height) invalid();
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) throw new Error('La imagen supera las dimensiones permitidas.');
  return { width, height };
}

export async function validateSketchBlob(blob: Blob) { return inspectImage(new Uint8Array(await blob.arrayBuffer()), blob.type); }
