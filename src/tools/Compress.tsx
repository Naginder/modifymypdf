import { useEffect, useState } from 'react';
import { FilePicker, Feedback, readPdfs, reconstructionWarning, ToolFrame, useOperation } from '../components/shared';
import type { ToolProps } from '../components/shared';
import { checkAbort, compressionResult, formatBytes } from '../lib/model';
import type { PdfInput } from '../lib/model';
import { canvasBytes, openPreview, PRESETS, renderPage } from '../lib/render';

export function Compress({ onBusy, onFiles }: ToolProps) {
  const [file, setFile] = useState<PdfInput>();
  const [mode, setMode] = useState('text');
  const [preset, setPreset] = useState<keyof typeof PRESETS>('balanced');
  const [acknowledged, setAcknowledged] = useState(false);
  const operation = useOperation(onBusy);
  useEffect(() => { onFiles(!!file); }, [file, onFiles]);
  return <ToolFrame title="Compress PDF">
    <p>Optimize one PDF locally. Not every PDF can be made smaller.</p>
    <FilePicker label={file ? 'Replace PDF' : 'Choose PDF'} accept="application/pdf,.pdf" busy={operation.busy} onFiles={(files) => void operation.run('Reading PDF…', async (context) => {
      if (files.length !== 1) throw new Error('Choose one PDF at a time.');
      const [loaded] = await readPdfs(files, context); setFile(loaded); setAcknowledged(false);
    })} />
    {file && <p><strong>{file.name}</strong> · {file.pages} pages · Original: {formatBytes(file.bytes.length)}</p>}
    <fieldset disabled={operation.busy}>
      <legend>Compression mode</legend>
      <label><input type="radio" name="compression-mode" checked={mode === 'text'} onChange={() => { setMode('text'); setAcknowledged(false); operation.invalidate(); }} />Preserve text (default)</label>
      <p className="muted">Compact serialization and object streams only. No image downsampling, font optimization, or guaranteed savings. Pages are not rasterized.</p>
      <label><input type="radio" name="compression-mode" checked={mode === 'image'} onChange={() => { setMode('image'); setAcknowledged(false); operation.invalidate(); }} />Smaller file / image-based</label>
      {mode === 'image' && <div className="notice">
        <p>Each page becomes a JPEG image. Selectable text, search, links, forms, accessibility structure, and vector detail are lost. Visible page size and orientation are retained.</p>
        <fieldset><legend>Image quality</legend>
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) =>
            <label key={key}><input type="radio" name="image-quality" checked={preset === key}
              onChange={() => { setPreset(key); operation.invalidate(); }} />{PRESETS[key].label}</label>)}
        </fieldset>
        <p className="muted">Large pages are capped at 8 megapixels / 8,192 pixels per side, so actual resolution may be lower.</p>
        <label><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); operation.invalidate(); }} />I understand that text and interactive features will be lost.</label>
      </div>}
    </fieldset>
    <p className="notice">{reconstructionWarning}</p>
    <button className="primary" disabled={!file || operation.busy || (mode === 'image' && !acknowledged)} onClick={() => {
      if (!file) return;
      void operation.run('Optimizing PDF…', async ({ signal, worker, progress }) => {
        let candidate: Uint8Array | undefined;
        if (mode === 'text') candidate = (await worker.run({ kind: 'optimize', bytes: file.bytes })).bytes;
        else {
          const preview = await openPreview(file.bytes, signal);
          const doc = preview.doc;
          const abort = () => { void preview.destroy(); };
          signal.addEventListener('abort', abort, { once: true });
          const canvas = document.createElement('canvas');
          try {
            await worker.run({ kind: 'raster-start' });
            for (let index = 1; index <= doc.numPages; index++) {
              checkAbort(signal); progress(`Rendering page ${index} of ${doc.numPages}`);
              const size = await renderPage(doc, index, canvas, PRESETS[preset].scale, signal);
              const bytes = await canvasBytes(canvas, 'image/jpeg', PRESETS[preset].quality);
              checkAbort(signal);
              await worker.run({ kind: 'raster-add', bytes, ...size });
              canvas.width = 0; canvas.height = 0;
            }
            candidate = (await worker.run({ kind: 'raster-save' })).bytes;
          } finally {
            signal.removeEventListener('abort', abort);
            canvas.width = 0; canvas.height = 0; await preview.destroy();
          }
        }
        if (!candidate) throw new Error('No output was produced.');
        return compressionResult(file.bytes, candidate);
      });
    }}>Compress PDF</button>
    <Feedback operation={operation} />
  </ToolFrame>;
}
