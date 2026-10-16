import { useEffect, useState } from 'react';
import { FilePicker, Feedback, readPdfs, reconstructionWarning, ReorderButtons, ToolFrame, useDragReorder, useOperation } from '../components/shared';
import type { ToolProps } from '../components/shared';
import { formatBytes, move } from '../lib/model';
import type { PdfInput } from '../lib/model';

export function Merge({ onBusy, onFiles }: ToolProps) {
  const [files, setFiles] = useState<PdfInput[]>([]);
  const operation = useOperation(onBusy);
  useEffect(() => { onFiles(files.length > 0); }, [files.length, onFiles]);
  const reorder = (from: number, to: number) => { setFiles(move(files, from, to)); operation.invalidate(); };
  const drag = useDragReorder(reorder, operation.busy);
  return <ToolFrame title="Merge PDFs">
    <p>Choose at least two PDFs. Pages are combined in the file order below.</p>
    <FilePicker label="Choose PDFs" accept="application/pdf,.pdf" multiple busy={operation.busy} onFiles={(selected) => void operation.run('Reading PDFs…', async (context) => {
      const loaded = await readPdfs(selected, context, files); setFiles([...files, ...loaded]);
    })} />
    <ol className="file-list">{files.map((file, index) => <li key={file.id} {...drag(index)}>
      <span className="file-details"><strong>{index + 1}. {file.name}</strong><span>{file.pages} pages · {formatBytes(file.bytes.length)}</span></span>
      <ReorderButtons index={index} count={files.length} label={file.name} disabled={operation.busy} onMove={(to) => reorder(index, to)}
        onRemove={() => { setFiles(files.filter((item) => item.id !== file.id)); operation.invalidate(); }} />
    </li>)}</ol>
    <p className="notice">{reconstructionWarning}</p>
    <button className="primary" disabled={files.length < 2 || operation.busy} onClick={() => void operation.run('Merging PDFs…', async ({ worker }) => {
      const result = await worker.run({ kind: 'merge', sources: files.map((file) => file.bytes) });
      if (!result.bytes) throw new Error('No output was produced.');
      return { bytes: result.bytes, name: 'merged.pdf' };
    })}>Merge PDFs</button>
    <Feedback operation={operation} />
  </ToolFrame>;
}
