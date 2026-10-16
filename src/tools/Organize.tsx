import { useEffect, useState } from 'react';
import { FilePicker, Feedback, readPdfs, reconstructionWarning, ReorderButtons, Thumbnail, ToolFrame, useDragReorder, useOperation, usePreview } from '../components/shared';
import type { ToolProps } from '../components/shared';
import { move, rotate } from '../lib/model';
import type { PageRef, PdfInput } from '../lib/model';

export function Organize({ onBusy, onFiles }: ToolProps) {
  const [file, setFile] = useState<PdfInput>();
  const [pages, setPages] = useState<PageRef[]>([]);
  const [history, setHistory] = useState<PageRef[][]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const operation = useOperation(onBusy);
  const preview = usePreview(file?.bytes);
  const dirty = !!file && (pages.length !== file.pages || pages.some((page, index) => page.original !== index || page.rotation !== 0));
  useEffect(() => { onFiles(!!file); }, [file, onFiles]);
  const original = () => Array.from({ length: file?.pages ?? 0 }, (_, index) => ({ original: index, rotation: 0 }));
  const edit = (next: PageRef[]) => {
    if (next === pages) return;
    setHistory([...history.slice(-19), pages]); setPages(next); operation.invalidate();
  };
  const reorder = (from: number, to: number) => edit(move(pages, from, to));
  const drag = useDragReorder(reorder, operation.busy);
  return <ToolFrame title="Organize Pages">
    <p>Select pages to rotate or delete. Drag pages to reorder, or use Earlier / Later.</p>
    <FilePicker label={file ? 'Replace PDF' : 'Choose PDF'} accept="application/pdf,.pdf" busy={operation.busy} onFiles={(files) => {
      if (dirty && !window.confirm('Replace this PDF and discard your page edits?')) return;
      void operation.run('Reading PDF…', async (context) => {
        if (files.length !== 1) throw new Error('Choose one PDF at a time.');
        const [loaded] = await readPdfs(files, context);
        setFile(loaded); setPages(Array.from({ length: loaded.pages }, (_, index) => ({ original: index, rotation: 0 })));
        setHistory([]); setSelected(new Set());
      });
    }} />
    {file && <>
      <p><strong>{file.name}</strong> · {pages.length} of {file.pages} pages · {selected.size} selected</p>
      <div className="toolbar">
        <button disabled={operation.busy} onClick={() => setSelected(new Set(pages.map((page) => page.original)))}>Select all</button>
        <button disabled={operation.busy || !selected.size} onClick={() => setSelected(new Set())}>Clear selection</button>
        <button disabled={operation.busy || !selected.size} onClick={() => edit(rotate(pages, selected, -90))}>Rotate left</button>
        <button disabled={operation.busy || !selected.size} onClick={() => edit(rotate(pages, selected, 90))}>Rotate right</button>
        <button disabled={operation.busy || !selected.size || selected.size === pages.length}
          onClick={() => { edit(pages.filter((page) => !selected.has(page.original))); setSelected(new Set()); }}>Delete selected</button>
        <button disabled={operation.busy || !history.length} onClick={() => {
          setPages(history[history.length - 1]); setHistory(history.slice(0, -1)); setSelected(new Set()); operation.invalidate();
        }}>Undo</button>
        <button disabled={operation.busy || !dirty} onClick={() => {
          if (window.confirm('Reset to the original page arrangement and discard edits?')) {
            setPages(original()); setHistory([]); setSelected(new Set()); operation.invalidate();
          }
        }}>Reset to original</button>
      </div>
      <p className="muted">Keep at least one page. Undo retains the last 20 edits. Preview rendering errors do not change your original PDF.</p>
      {preview.error && <p className="error" role="alert">{preview.error}</p>}
      <ol className="pages" key={file.id}>{pages.map((page, index) => <li key={page.original} {...drag(index)}>
        <label><input type="checkbox" checked={selected.has(page.original)} disabled={operation.busy}
          onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(page.original); else next.delete(page.original); setSelected(next); }} />
          Page {index + 1} <span className="muted">(original {page.original + 1})</span></label>
        <Thumbnail preview={preview} original={page.original} rotation={page.rotation} />
        <span className="muted">Added rotation: {page.rotation}°</span>
        <ReorderButtons index={index} count={pages.length} label={`page ${index + 1}`} disabled={operation.busy} onMove={(to) => reorder(index, to)} />
      </li>)}</ol>
      <p className="notice">{reconstructionWarning}</p>
      <button className="primary" disabled={operation.busy || !pages.length} onClick={() => void operation.run('Exporting arrangement…', async ({ worker }) => {
        const result = await worker.run({ kind: 'organize', bytes: file.bytes, pages });
        if (!result.bytes) throw new Error('No output was produced.');
        return { bytes: result.bytes, name: 'organized.pdf' };
      })}>Export PDF</button>
    </>}
    <Feedback operation={operation} />
  </ToolFrame>;
}
