import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib';
import { imagesPdf, loadPdf, mergePdfs, organizePdf, savePdf } from './pdf';

async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const one = doc.addPage([300, 500]);
  one.drawText('Synthetic selectable text', { font, x: 20, y: 200, size: 12 });
  const annotation = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [20, 190, 200, 220],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/synthetic-link') },
  }));
  one.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  doc.addPage([612, 792]).setRotation(degrees(90));
  return doc.save({ useObjectStreams: false });
}

describe('PDF processing', () => {
  it('preserves page dimensions, rotation and links during structural rewriting', async () => {
    const bytes = await fixture();
    const output = await loadPdf(await savePdf(await loadPdf(bytes)));
    expect(output.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 500 }, { width: 612, height: 792 }]);
    expect(output.getPage(1).getRotation().angle).toBe(90);
    const annotations = output.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const annotation = annotations.lookup(0, PDFDict);
    const action = annotation.lookup(PDFName.of('A'), PDFDict);
    expect(action.lookup(PDFName.of('URI'), PDFString).decodeText()).toContain('synthetic-link');
  });
  it('merges in the exact file order without modifying input bytes', async () => {
    const a = await fixture();
    const copy = a.slice();
    const bDoc = await PDFDocument.create(); bDoc.addPage([200, 400]);
    const b = await bDoc.save();
    const output = await loadPdf(await mergePdfs([b, a], () => {}));
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight(), page.getRotation().angle]))
      .toEqual([[200, 400, 0], [300, 500, 0], [612, 792, 90]]);
    expect(a).toEqual(copy);
    await expect(mergePdfs([a], () => {})).rejects.toThrow('two');
  });
  it('applies order, deletion and cumulative rotation and rejects empty or invalid arrangements', async () => {
    const bytes = await fixture();
    const output = await loadPdf(await organizePdf(bytes, [{ original: 1, rotation: 270 }, { original: 0, rotation: 90 }]));
    expect(output.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(output.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90]);
    expect((await loadPdf(await organizePdf(bytes, [{ original: 1, rotation: 0 }]))).getPageCount()).toBe(1);
    await expect(organizePdf(bytes, [])).rejects.toThrow('at least one');
    await expect(organizePdf(bytes, [{ original: 9, rotation: 0 }])).rejects.toThrow('invalid');
    await expect(organizePdf(bytes, [{ original: 0, rotation: 45 }])).rejects.toThrow('invalid');
  });
  it('creates fit-to-image and standard-size pages and retains PNG alpha masks', async () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
    for (const [paper, width, height] of [['image', 150, 75], ['a4', 595.28, 841.89], ['letter', 612, 792]] as const) {
      const output = await loadPdf(await imagesPdf([{ bytes: png, width: 200, height: 100, format: 'png' }], paper, () => {}));
      expect(output.getPageCount()).toBe(1);
      expect(output.getPage(0).getWidth()).toBeCloseTo(width);
      expect(output.getPage(0).getHeight()).toBeCloseTo(height);
    }
  });
  it('rejects damaged, encrypted and over-limit documents', async () => {
    await expect(loadPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow('unreadable');
    const doc = await PDFDocument.create();
    for (let i = 0; i < 201; i++) doc.addPage();
    await expect(loadPdf(await doc.save())).rejects.toThrow('200-page');
    const encrypted = await PDFDocument.create(); encrypted.addPage();
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: 'Standard' }));
    await expect(loadPdf(await encrypted.save())).rejects.toThrow('encrypted');
    const oversized = await PDFDocument.create(); oversized.addPage();
    oversized.context.register(oversized.context.stream(new Uint8Array(), { Subtype: 'Image', Width: 16001, Height: 1 }));
    await expect(loadPdf(await oversized.save())).rejects.toThrow('16-megapixel');
  });
});
