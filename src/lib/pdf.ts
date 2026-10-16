import { PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees } from 'pdf-lib';
import { LIMITS } from './model';
import type { ImageData, PageRef, Paper } from './model';

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.length > LIMITS.totalBytes) throw new Error('The document exceeds the 60 MB processing limit.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) {
      throw new Error('Password-protected or encrypted PDFs are not supported. Choose an unencrypted PDF.');
    }
    throw new Error('This PDF is unreadable or damaged. Try opening and exporting it in a trusted PDF reader.');
  }
  if (!doc.getPageCount()) throw new Error('The PDF contains no pages.');
  if (doc.getPageCount() > LIMITS.pages) throw new Error('The PDF exceeds the 200-page limit.');
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const width = object.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
    const height = object.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
    if (!width || !height || width * height > LIMITS.imagePixels || width > 16000 || height > 16000) {
      throw new Error('A PDF image exceeds the 16-megapixel / 16,000-pixel limit or has invalid dimensions. Resize the source images first.');
    }
  }
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) {
      throw new Error('The PDF has invalid or excessively large page dimensions.');
    }
    if (page.getRotation().angle % 90 !== 0) throw new Error('The PDF has an unsupported page rotation.');
  }
  return doc;
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  if (bytes.length > LIMITS.outputBytes) throw new Error('The result exceeds the 120 MB output limit. Try fewer pages or lower image quality.');
  return bytes;
}

export async function imagesPdf(images: ImageData[], paper: Paper, progress: (message: string) => void): Promise<Uint8Array> {
  if (!images.length || images.length > LIMITS.files) throw new Error('Choose between 1 and 60 images.');
  const doc = await PDFDocument.create();
  for (const [index, image] of images.entries()) {
    const embedded = image.format === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    const size: [number, number] = paper === 'a4' ? [595.28, 841.89] : paper === 'letter' ? [612, 792]
      : [image.width * 0.75, image.height * 0.75];
    const page = doc.addPage(size);
    const scale = Math.min(size[0] / image.width, size[1] / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(embedded, { x: (size[0] - width) / 2, y: (size[1] - height) / 2, width, height });
    progress(`Adding image ${index + 1} of ${images.length}`);
  }
  return savePdf(doc);
}

export async function mergePdfs(sources: Uint8Array[], progress: (message: string) => void): Promise<Uint8Array> {
  if (sources.length < 2) throw new Error('Choose at least two PDFs to merge.');
  const output = await PDFDocument.create();
  for (const [index, bytes] of sources.entries()) {
    const source = await loadPdf(bytes);
    if (output.getPageCount() + source.getPageCount() > LIMITS.pages) throw new Error('The merged PDF would exceed 200 pages.');
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    progress(`Copying PDF ${index + 1} of ${sources.length}`);
  }
  return savePdf(output);
}

export async function organizePdf(bytes: Uint8Array, refs: PageRef[]): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  if (!refs.length) throw new Error('Keep at least one page before exporting.');
  if (refs.length > LIMITS.pages || new Set(refs.map((ref) => ref.original)).size !== refs.length
    || refs.some((ref) => !Number.isInteger(ref.original) || ref.original < 0 || ref.original >= source.getPageCount()
      || !Number.isInteger(ref.rotation) || ref.rotation % 90 !== 0)) {
    throw new Error('The page arrangement is invalid. Reset the arrangement and try again.');
  }
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, refs.map((ref) => ref.original));
  pages.forEach((page, index) => {
    page.setRotation(degrees(((page.getRotation().angle + refs[index].rotation) % 360 + 360) % 360));
    output.addPage(page);
  });
  return savePdf(output);
}
