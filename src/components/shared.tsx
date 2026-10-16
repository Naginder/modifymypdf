import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { checkAbort, checkFiles, failure, formatBytes, LIMITS, tabId } from '../lib/model';
import type { PdfInput, Result } from '../lib/model';
import { PdfWorker } from '../lib/worker';
import { openPreview, renderPage } from '../lib/render';
import type { PreviewDocument } from '../lib/render';

export type ToolProps = { onBusy: (value: boolean) => void; onFiles: (value: boolean) => void };
export type Operation = {
  signal: AbortSignal; worker: PdfWorker; progress: (message: string) => void;
};

export function useOperation(onBusy: ToolProps['onBusy']) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const run = async (message: string, action: (operation: Operation) => Promise<Result | void>) => {
    if (controller.current) return;
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(true); setError(''); setResult(undefined); setStatus(message);
    let worker: PdfWorker | undefined;
    try {
      worker = new PdfWorker(aborter.signal, setStatus);
      const output = await action({ signal: aborter.signal, worker, progress: setStatus });
      checkAbort(aborter.signal);
      setResult(output || undefined); setStatus(output ? 'Ready to download. Nothing has been saved.' : 'Files ready.');
    } catch (caught) {
      if (aborter.signal.aborted) setStatus('Operation cancelled. No output was saved.');
      else { setError(failure(caught)); setStatus(''); }
    } finally {
      worker?.dispose();
      if (controller.current === aborter) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  return { busy, status, error, result, run, cancel: () => controller.current?.abort(), invalidate: () => setResult(undefined) };
}

export async function readPdfs(files: File[], operation: Operation, existing: PdfInput[] = []): Promise<PdfInput[]> {
  checkFiles(files, existing.reduce((sum, file) => sum + file.bytes.length, 0), existing.length);
  const loaded: PdfInput[] = [];
  for (const file of files) {
    operation.progress(`Reading PDF ${loaded.length + 1} of ${files.length}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    checkAbort(operation.signal);
    if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) {
      throw new Error(`${file.name}: this is not a PDF file.`);
    }
    let pages: number | undefined;
    try { pages = (await operation.worker.run({ kind: 'inspect', bytes })).pages; }
    catch (error) { checkAbort(operation.signal); throw new Error(`${file.name}: ${failure(error)}`); }
    if (!pages) throw new Error(`${file.name}: no readable pages were found.`);
    if ([...existing, ...loaded].reduce((sum, pdf) => sum + pdf.pages, pages) > LIMITS.pages) {
      throw new Error('Selected PDFs exceed the combined 200-page limit.');
    }
    loaded.push({ id: crypto.randomUUID(), name: file.name, bytes, pages });
  }
  return loaded;
}

export function FilePicker({ accept, multiple = false, busy, onFiles, label }: {
  accept: string; multiple?: boolean; busy: boolean; label: string;
  onFiles: (files: File[]) => void;
}) {
  const [drag, setDrag] = useState(false);
  return <div className={`file-picker ${drag ? 'dragging' : ''}`}
    onDragOver={(event) => { event.preventDefault(); if (!busy) setDrag(true); }}
    onDragLeave={() => setDrag(false)}
    onDrop={(event) => {
      event.preventDefault(); setDrag(false);
      if (!busy) onFiles(Array.from(event.dataTransfer.files));
    }}>
    <label className="choose-button">
      <span>{label}</span>
      <input aria-label={label} type="file" accept={accept} multiple={multiple} disabled={busy}
        onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) onFiles(files); }} />
    </label>
    <span> or drop {multiple ? 'files' : 'a file'} here</span>
    <p className="muted">Local files only. No uploads or autosaving. 30 MB per file, 60 MB total; up to 200 PDF pages or 60 images.</p>
  </div>;
}

export function Feedback({ operation }: { operation: ReturnType<typeof useOperation> }) {
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const active = urls.current;
    return () => { active.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); }); active.clear(); };
  }, []);
  const download = () => {
    const result = operation.result;
    if (!result) return;
    const blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = result.name; link.click();
    // Give the browser a turn to start the explicitly requested download.
    const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
    urls.current.set(url, timer);
  };
  return <div className="feedback">
    <div role="status" aria-live="polite">{operation.status}</div>
    {operation.busy && <button onClick={operation.cancel}>Cancel operation</button>}
    {operation.error && <p className="error" role="alert">{operation.error}</p>}
    {operation.result && <div className="result">
      <p>{operation.result.message ?? `PDF ready (${formatBytes(operation.result.bytes.length)}).`}</p>
      <button className="primary" onClick={download}>Download {operation.result.name === 'original.pdf' ? 'original PDF' : 'PDF'}</button>
    </div>}
  </div>;
}

export function ReorderButtons({ index, count, label, disabled, onMove, onRemove }: {
  index: number; count: number; label: string; disabled: boolean;
  onMove: (to: number) => void; onRemove?: () => void;
}) {
  return <span className="item-actions">
    <button aria-label={`Move ${label} earlier`} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}>Earlier</button>
    <button aria-label={`Move ${label} later`} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)}>Later</button>
    {onRemove && <button aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove}>Remove</button>}
  </span>;
}

export function useDragReorder(onMove: (from: number, to: number) => void, busy: boolean) {
  const from = useRef<number | null>(null);
  return (index: number) => ({
    draggable: !busy,
    onDragStart: (event: React.DragEvent) => {
      from.current = index;
      event.dataTransfer.effectAllowed = 'move';
      // Only a position marker is needed; no document data enters the drag payload.
      event.dataTransfer.clearData();
      event.dataTransfer.setData('text/plain', String(index));
    },
    onDragOver: (event: React.DragEvent) => { if (from.current !== null) event.preventDefault(); },
    onDrop: (event: React.DragEvent) => {
      if (from.current === null) return;
      event.preventDefault(); event.stopPropagation();
      if (!busy) onMove(from.current, index);
      from.current = null;
    },
    onDragEnd: () => { from.current = null; },
  });
}

export function ToolFrame({ title, children }: { title: string; children: ReactNode }) {
  return <section role="tabpanel" id="tool-panel" aria-labelledby={tabId(title)} tabIndex={0}>
    <h2>{title}</h2>{children}
  </section>;
}

export const reconstructionWarning = 'Editing signed PDFs invalidates signatures. Rebuilding or copying pages may not retain forms, bookmarks, attachments, annotations, or other advanced features. Keep your original.';

export function usePreview(bytes: Uint8Array | undefined) {
  const [openedDoc, setOpenedDoc] = useState<{ bytes: Uint8Array; doc: PDFDocumentProxy }>();
  const doc = openedDoc?.bytes === bytes ? openedDoc?.doc : undefined;
  const [error, setError] = useState('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((work: () => Promise<void>) => {
    const next = queue.current.then(work, work);
    queue.current = next;
    return next;
  }, []);
  useEffect(() => {
    if (!bytes) return;
    const controller = new AbortController();
    let opened: PreviewDocument | undefined;
    setError('');
    void openPreview(bytes, controller.signal).then((preview) => {
      opened = preview;
      if (controller.signal.aborted) void preview.destroy();
      else setOpenedDoc({ bytes, doc: preview.doc });
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(failure(caught));
    });
    return () => {
      controller.abort(); setOpenedDoc(undefined);
      if (opened) void opened.destroy();
    };
  }, [bytes]);
  return { doc, error, enqueue };
}

export function Thumbnail({ preview, original, rotation }: {
  preview: ReturnType<typeof usePreview>; original: number; rotation: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const { doc, enqueue } = preview;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !doc || !host.current) return;
    const controller = new AbortController();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `Preview of original page ${original + 1}`);
    canvas.setAttribute('role', 'img');
    host.current.append(canvas); setError('');
    void enqueue(async () => {
      checkAbort(controller.signal);
      const page = await doc.getPage(original + 1);
      const size = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      await renderPage(doc, original + 1, canvas, Math.min(200 / size.width, 240 / size.height), controller.signal, rotation);
      canvas.dataset.rendered = 'true';
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(failure(caught));
    });
    return () => { controller.abort(); delete canvas.dataset.rendered; canvas.remove(); canvas.width = 0; canvas.height = 0; };
  }, [visible, doc, enqueue, original, rotation]);
  return <div className="thumbnail" ref={host}>{error && <span className="error" role="alert">{error}</span>}
    {!doc && <span className="muted">Preview loading</span>}
  </div>;
}
