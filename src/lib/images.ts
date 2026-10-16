import { canvasBytes } from './render';
import { checkAbort, LIMITS } from './model';
import type { ImageInput } from './model';
import { imageDimensions } from './image-dimensions';

export async function readImage(file: File, signal: AbortSignal): Promise<ImageInput> {
  const header = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  const { format } = imageDimensions(header);
  const jpeg = format === 'jpg';
  let image: ImageBitmap;
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image is unreadable. Try exporting it as JPEG or PNG.'); }
  const canvas = document.createElement('canvas');
  try {
    checkAbort(signal);
    if (!image.width || !image.height || image.width * image.height > LIMITS.imagePixels || image.width > 16000 || image.height > 16000) {
      throw new Error('Each image must be at most 16 megapixels and 16,000 pixels per side.');
    }
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is not supported in this browser.');
    context.drawImage(image, 0, 0);
    const bytes = await canvasBytes(canvas, jpeg ? 'image/jpeg' : 'image/png', 0.98);
    checkAbort(signal);
    const width = image.width; const height = image.height;
    canvas.width = Math.max(1, Math.round(width * Math.min(1, 240 / width, 180 / height)));
    canvas.height = Math.max(1, Math.round(height * Math.min(1, 240 / width, 180 / height)));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/png');
    return { id: crypto.randomUUID(), name: file.name, bytes, format: jpeg ? 'jpg' : 'png', width, height, preview };
  } finally {
    image.close(); canvas.width = 0; canvas.height = 0;
  }
}
