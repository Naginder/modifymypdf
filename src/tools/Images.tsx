import { useEffect, useState } from 'react';
import { FilePicker, Feedback, ReorderButtons, ToolFrame, useDragReorder, useOperation } from '../components/shared';
import type { ToolProps } from '../components/shared';
import { checkAbort, checkFiles, failure, LIMITS, move } from '../lib/model';
import type { ImageInput, Paper } from '../lib/model';
import { readImage } from '../lib/images';

export function Images({ onBusy, onFiles }: ToolProps) {
  const [images, setImages] = useState<ImageInput[]>([]);
  const [paper, setPaper] = useState<Paper>('image');
  const operation = useOperation(onBusy);
  useEffect(() => { onFiles(images.length > 0); }, [images.length, onFiles]);
  const reorder = (from: number, to: number) => { setImages(move(images, from, to)); operation.invalidate(); };
  const drag = useDragReorder(reorder, operation.busy);
  const add = (files: File[]) => void operation.run('Reading images…', async ({ signal, progress }) => {
    checkFiles(files, images.reduce((sum, image) => sum + image.bytes.length, 0), images.length);
    const loaded: ImageInput[] = [];
    let pixels = images.reduce((sum, image) => sum + image.width * image.height, 0);
    let bytes = images.reduce((sum, image) => sum + image.bytes.length, 0);
    for (const [index, file] of files.entries()) {
      progress(`Reading image ${index + 1} of ${files.length}`);
      let image: ImageInput;
      try { image = await readImage(file, signal); }
      catch (error) { checkAbort(signal); throw new Error(`${file.name}: ${failure(error)}`); }
      pixels += image.width * image.height; bytes += image.bytes.length;
      if (pixels > LIMITS.totalImagePixels || bytes > LIMITS.totalBytes) {
        throw new Error('Decoded images exceed the 80-megapixel or 60 MB total limit. Choose fewer or smaller images.');
      }
      loaded.push(image);
    }
    checkAbort(signal); setImages([...images, ...loaded]);
  });
  return <ToolFrame title="Images to PDF">
    <p>One image per page, without cropping. JPEG, PNG, and WebP are supported.</p>
    <FilePicker label="Choose images" accept="image/jpeg,image/png,image/webp" multiple busy={operation.busy} onFiles={add} />
    <ol className="file-list">{images.map((image, index) => <li key={image.id} {...drag(index)}>
      <img className="image-preview" src={image.preview} alt="" draggable={false} />
      <span className="file-details"><strong>{index + 1}. {image.name}</strong><span>{image.width} × {image.height} pixels</span></span>
      <ReorderButtons index={index} count={images.length} label={image.name} disabled={operation.busy} onMove={(to) => reorder(index, to)}
        onRemove={() => { setImages(images.filter((item) => item.id !== image.id)); operation.invalidate(); }} />
    </li>)}</ol>
    <div className="toolbar">
      <fieldset className="options-inline" disabled={operation.busy}><legend>Page size</legend>
        {([['image', 'Fit to image (96 dpi)'], ['a4', 'A4'], ['letter', 'Letter']] satisfies [Paper, string][]).map(([value, label]) =>
          <label key={value}><input type="radio" name="paper" checked={paper === value}
            onChange={() => { setPaper(value); operation.invalidate(); }} />{label}</label>)}
      </fieldset>
      <button className="primary" disabled={!images.length || operation.busy} onClick={() => void operation.run('Creating PDF…', async ({ worker }) => {
        const result = await worker.run({ kind: 'images', images: images.map(({ bytes, width, height, format }) => ({ bytes, width, height, format })), paper });
        if (!result.bytes) throw new Error('No output was produced.');
        return { bytes: result.bytes, name: 'images.pdf' };
      })}>Create PDF</button>
    </div>
    <p className="muted">Image orientation is applied during decoding. PNG transparency is retained. JPEGs are re-encoded at high quality. Fixed paper sizes use centered aspect-ratio fitting.</p>
    <Feedback operation={operation} />
  </ToolFrame>;
}
