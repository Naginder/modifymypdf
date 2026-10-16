export const LIMITS = {
  fileBytes: 30 * 1024 * 1024,
  totalBytes: 60 * 1024 * 1024,
  pages: 200,
  files: 60,
  imagePixels: 16_000_000,
  totalImagePixels: 80_000_000,
  renderPixels: 8_000_000,
  outputBytes: 120 * 1024 * 1024,
};

export type PageRef = { original: number; rotation: number };
export type PdfInput = { id: string; name: string; bytes: Uint8Array; pages: number };
export type ImageInput = {
  id: string; name: string; bytes: Uint8Array; format: 'png' | 'jpg';
  width: number; height: number; preview: string;
};
export type Paper = 'image' | 'a4' | 'letter';
export type ImageData = Pick<ImageInput, 'bytes' | 'format' | 'width' | 'height'>;
export type Result = { bytes: Uint8Array; name: string; message?: string };
export type Job =
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'images'; images: ImageData[]; paper: Paper }
  | { kind: 'merge'; sources: Uint8Array[] }
  | { kind: 'organize'; bytes: Uint8Array; pages: PageRef[] }
  | { kind: 'optimize'; bytes: Uint8Array }
  | { kind: 'raster-start' }
  | { kind: 'raster-add'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'raster-save' };
export type JobResult = { bytes?: Uint8Array; pages?: number };
export type WorkerResponse =
  | { type: 'progress'; message: string }
  | { type: 'result'; result: JobResult }
  | { type: 'error'; message: string };

export function tabId(title: string): string {
  return `tab-${title.toLowerCase().replaceAll(' ', '-')}`;
}

export function move<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function rotate(pages: PageRef[], selected: Set<number>, delta: number): PageRef[] {
  return pages.map((page) => selected.has(page.original)
    ? { ...page, rotation: ((page.rotation + delta) % 360 + 360) % 360 }
    : page);
}

export function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function compressionResult(original: Uint8Array, candidate: Uint8Array): Result {
  if (candidate.length >= original.length) {
    return { bytes: original, name: 'original.pdf', message: `No size reduction achieved. Candidate: ${formatBytes(candidate.length)} (${((candidate.length / original.length - 1) * 100).toFixed(1)}% larger or unchanged). Original recommended for download.` };
  }
  return { bytes: candidate, name: 'compressed.pdf', message: `${formatBytes(original.length)} → ${formatBytes(candidate.length)}. ${((1 - candidate.length / original.length) * 100).toFixed(1)}% smaller.` };
}

export function checkFiles(files: File[], existingBytes = 0, existingCount = 0): void {
  if (!files.length) throw new Error('Choose at least one file.');
  if (files.length + existingCount > LIMITS.files) throw new Error(`Choose at most ${LIMITS.files} files in total.`);
  if (files.some((file) => file.size === 0)) throw new Error('Empty files cannot be processed.');
  if (files.some((file) => file.size > LIMITS.fileBytes)) throw new Error('Each file must be 30 MB or smaller.');
  if (files.reduce((sum, file) => sum + file.size, existingBytes) > LIMITS.totalBytes) {
    throw new Error('Selected files must total 60 MB or less. Clear files or choose fewer inputs.');
  }
}

export function failure(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Operation cancelled. No output was saved.';
  return error instanceof Error ? error.message : 'The operation failed. Try a smaller or different file.';
}

export function checkAbort(signal: AbortSignal): void {
  signal.throwIfAborted();
}
