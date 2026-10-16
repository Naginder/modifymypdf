import * as pdfjs from 'pdfjs-dist';
import RenderingWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { checkAbort, LIMITS } from './model';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Inline auxiliary data so PDF.js never needs fetch, even for CJK or standard fonts.
const assets = import.meta.glob<string>('/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}', {
  eager: true, query: '?url&inline', import: 'default',
});
function assetBytes(folder: string, filename: string): Uint8Array {
  const url = assets[`/node_modules/pdfjs-dist/${folder}/${filename}`];
  if (!url?.startsWith('data:')) throw new Error('A required bundled PDF rendering asset is unavailable. Reload the website.');
  const raw = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
class LocalCMaps {
  async fetch({ name }: { name: string }) { return { cMapData: assetBytes('cmaps', `${name}.bcmap`), isCompressed: true }; }
}
class LocalFonts {
  async fetch({ filename }: { filename: string }) { return assetBytes('standard_fonts', filename); }
}
class LocalWasm {
  async fetch({ filename }: { filename: string }) { return assetBytes('wasm', filename); }
}

export type PreviewDocument = { doc: PDFDocumentProxy; destroy: () => Promise<void> };

export async function openPreview(bytes: Uint8Array, signal: AbortSignal): Promise<PreviewDocument> {
  checkAbort(signal);
  const port = new RenderingWorker();
  const worker = pdfjs.PDFWorker.create({ port, verbosity: 0 });
  const task = pdfjs.getDocument({
    data: bytes.slice(), worker, useWorkerFetch: false, isEvalSupported: false,
    CMapReaderFactory: LocalCMaps, StandardFontDataFactory: LocalFonts, WasmFactory: LocalWasm,
    useSystemFonts: false, stopAtErrors: true, maxImageSize: LIMITS.imagePixels,
    canvasMaxAreaInBytes: LIMITS.renderPixels * 4, verbosity: 0,
  });
  let destruction: Promise<void> | undefined;
  const destroy = () => {
    destruction ??= task.destroy().finally(() => { worker.destroy(); port.terminate(); });
    return destruction;
  };
  let rejectInterruption: (reason: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  const abort = () => { rejectInterruption(new DOMException('Cancelled', 'AbortError')); void destroy(); };
  const workerError = (event: ErrorEvent) => {
    event.preventDefault();
    rejectInterruption(new Error('The PDF rendering worker could not start.'));
  };
  port.addEventListener('error', workerError);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const doc = await Promise.race([task.promise, interrupted]);
    checkAbort(signal);
    return { doc, destroy };
  } catch {
    await destroy();
    checkAbort(signal);
    throw new Error('This PDF could not be rendered. It may be damaged or use unsupported features.');
  } finally {
    signal.removeEventListener('abort', abort);
    port.removeEventListener('error', workerError);
  }
}

export async function renderPage(
  doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement,
  scale: number, signal: AbortSignal, rotation = 0,
): Promise<{ width: number; height: number }> {
  checkAbort(signal);
  const page = await doc.getPage(pageNumber);
  checkAbort(signal);
  const natural = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const boundedScale = Math.min(scale, Math.sqrt(LIMITS.renderPixels / (natural.width * natural.height)), 8192 / natural.width, 8192 / natural.height);
  const viewport = page.getViewport({ scale: boundedScale, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  const render = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255, 255, 255)' });
  const abort = () => render.cancel();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await render.promise;
    checkAbort(signal);
    return { width: natural.width, height: natural.height };
  } finally {
    signal.removeEventListener('abort', abort);
    page.cleanup();
  }
}

export async function canvasBytes(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (result) => result ? resolve(result) : reject(new Error('Image encoding failed. Try a smaller image.')), type, quality,
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

export const PRESETS = {
  balanced: { label: 'Balanced — 108 dpi, JPEG 72%', scale: 1.5, quality: 0.72 },
  smaller: { label: 'Smaller — 72 dpi, JPEG 55%', scale: 1, quality: 0.55 },
  sharper: { label: 'Sharper — 144 dpi, JPEG 85%', scale: 2, quality: 0.85 },
};
