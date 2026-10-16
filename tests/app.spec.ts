import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

declare global {
  interface Window { privacyViolations: string[] }
}

async function pdfFixture(options: { pages?: number; compact?: boolean; encrypted?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (options.pages ?? 3); i++) {
    const page = doc.addPage([300 + i * 10, 400 + i * 20]);
    page.drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(1, 0, 0) });
    page.drawText(`Synthetic page ${i + 1}`, { font, x: 20, y: 200, size: 18 });
    if (i === 1) page.setRotation(degrees(90));
    const annotation = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [20, 180, 250, 220],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/synthetic-link') },
    }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  }
  if (options.encrypted) doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard' }));
  return Buffer.from(await doc.save({ useObjectStreams: options.compact ?? false }));
}

async function imageFixture(page: Page, type: 'image/png' | 'image/jpeg' | 'image/webp', noise = false) {
  const data = await page.evaluate(({ type, noise }) => {
    const canvas = document.createElement('canvas');
    canvas.width = noise ? 480 : 120; canvas.height = noise ? 640 : 80;
    const context = canvas.getContext('2d')!;
    if (noise) {
      const image = context.createImageData(canvas.width, canvas.height);
      let seed = 123456;
      for (let i = 0; i < image.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        image.data[i] = seed & 255; image.data[i + 1] = (seed >>> 8) & 255;
        image.data[i + 2] = (seed >>> 16) & 255; image.data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    } else {
      context.fillStyle = '#ff0000'; context.fillRect(0, 0, canvas.width / 2, canvas.height);
      context.fillStyle = '#0000ff'; context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height / 2);
    }
    return canvas.toDataURL(type);
  }, { type, noise });
  expect(data).toContain(`data:${type}`);
  return Buffer.from(data.split(',')[1], 'base64');
}

function orientationSix(jpeg: Buffer) {
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0,
    0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0,
    0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

async function choosePdf(page: Page, buffer: Buffer, name = 'synthetic-private.pdf') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  await expect(page.getByRole('status')).toHaveText('Files ready.');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download/ }).click();
  const item = await event;
  const stream = await item.createReadStream();
  if (!stream) throw new Error('Download stream unavailable.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function textOf(bytes: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const text = await (await doc.getPage(i)).getTextContent();
      texts.push(text.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return texts;
  } finally { await doc.destroy(); }
}

async function selectTool(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click();
}

async function previewPixels(page: Page) {
  let pixels: number[] | undefined;
  await expect.poll(async () => {
    pixels = await page.evaluate(() => {
      const element = document.querySelector<HTMLCanvasElement>('.thumbnail canvas[data-rendered=true]');
      if (!element?.width || !element.height) return undefined;
      return Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data);
    });
    return !!pixels;
  }).toBe(true);
  if (!pixels) throw new Error('No rendered page pixels are available.');
  return pixels;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.privacyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.privacyViolations.push(`${event.violatedDirective}: ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} ${event.sample}`);
    });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'PDF Tools', exact: true })).toBeVisible();
  // Every subsequent operation must work without any HTTP(S) requests.
  await page.route(/^https?:/, (route) => {
    expect(route.request().url(), 'No operation may request network resources').toBe('');
    return route.abort();
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.privacyViolations)).toEqual([]);
  expect(await page.evaluate(() => ({
    local: localStorage.length, session: sessionStorage.length,
    url: location.pathname + location.search + location.hash,
  }))).toEqual({ local: 0, session: 0, url: '/modifymypdf/' });
  expect(await page.evaluate(async () => await caches.keys())).toEqual([]);
  const databases = await page.evaluate(async () => typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []);
  expect(databases).toEqual([]);
});

test('creates ordered image PDFs with PNG transparency, WebP and EXIF orientation', async ({ page }) => {
  const png = await imageFixture(page, 'image/png');
  const jpeg = orientationSix(await imageFixture(page, 'image/jpeg'));
  const webp = await imageFixture(page, 'image/webp');
  let automaticDownloads = 0;
  page.on('download', () => automaticDownloads++);
  await page.locator('input[type=file]').setInputFiles([
    { name: 'transparent.png', mimeType: 'image/png', buffer: png },
    { name: 'oriented.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'sample.webp', mimeType: 'image/webp', buffer: webp },
  ]);
  await expect(page.getByRole('status')).toHaveText('Files ready.');
  await expect(page.getByText('80 × 120 pixels')).toBeVisible();
  await page.getByRole('button', { name: 'Move sample.webp earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Create PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
  expect(automaticDownloads).toBe(0);
  const output = await PDFDocument.load(await download(page));
  expect(output.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[90, 60], [90, 60], [60, 90]]);
  const pngResources = output.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const embedded = output.context.lookup(pngResources.values()[0]);
  expect(embedded?.toString()).toContain('/SMask');
  await page.getByRole('radio', { name: 'A4', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create PDF', exact: true }).click();
  const a4 = await PDFDocument.load(await download(page));
  expect(a4.getPages().every((p) => Math.abs(p.getWidth() - 595.28) < 0.01)).toBe(true);
  await page.getByRole('button', { name: 'Remove sample.webp', exact: true }).click();
  await expect(page.locator('.file-list li')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear files', exact: true }).click();
  await expect(page.locator('.file-list li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
});

test('merges all pages in selected order and never produces a partial merge', async ({ page }) => {
  await selectTool(page, 'Merge PDFs');
  const a = await pdfFixture({ pages: 2 }); const b = await pdfFixture({ pages: 1 });
  await page.locator('input[type=file]').setInputFiles([
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: a },
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: b },
  ]);
  await expect(page.getByRole('status')).toHaveText('Files ready.');
  await page.locator('.file-list li').first().dragTo(page.locator('.file-list li').last());
  await expect(page.locator('.file-list li').first()).toContainText('one.pdf');
  await page.getByRole('button', { name: 'Move one.pdf later', exact: true }).click();
  await page.getByRole('button', { name: 'Move one.pdf earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Merge PDFs', exact: true }).click();
  const bytes = await download(page);
  const result = await PDFDocument.load(bytes);
  expect(result.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle]))
    .toEqual([[300, 400, 0], [300, 400, 0], [310, 420, 90]]);
  expect(await textOf(bytes)).toEqual(['Synthetic page 1', 'Synthetic page 1', 'Synthetic page 2']);
  await page.locator('input[type=file]').setInputFiles([
    { name: 'good.pdf', mimeType: 'application/pdf', buffer: b },
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-broken') },
  ]);
  await expect(page.getByRole('alert')).toContainText('broken.pdf');
  await expect(page.locator('.file-list li')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
});

test('organizes with previews, selection, rotation, reorder, undo, reset and discard protection', async ({ page }) => {
  await selectTool(page, 'Organize Pages');
  const source = await pdfFixture();
  await choosePdf(page, source);
  await expect(page.locator('.thumbnail canvas').first()).toBeVisible();
  await expect.poll(() => page.locator('.thumbnail canvas').first().evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from(pixels).some((value, index) => index % 4 === 1 && value < 100);
  })).toBe(true);
  await page.getByRole('checkbox', { name: 'Page 2 (original 2)', exact: true }).check();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const exported = await download(page);
  const result = await PDFDocument.load(exported);
  expect(result.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([[310, 270], [300, 0], [320, 0]]);
  expect(await textOf(exported)).toEqual(['Synthetic page 2', 'Synthetic page 1', 'Synthetic page 3']);
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(page.locator('.pages > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.pages > li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete selected', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reset to original', exact: true }).click();
  await expect(page.locator('.pages > li').first()).toContainText('original 2');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await pdfFixture({ pages: 1 }) });
  await expect(page.locator('.pages > li')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset to original', exact: true }).click();
  await expect(page.locator('.pages > li').first()).toContainText('original 1');
  expect((await PDFDocument.load(source)).getPage(1).getRotation().angle).toBe(90);
});

test('structural compression keeps text and links and handles no-reduction honestly', async ({ page }) => {
  await selectTool(page, 'Compress PDF');
  await expect(page.getByRole('radio', { name: 'Preserve text (default)' })).toBeChecked();
  const source = await pdfFixture({ compact: false });
  await choosePdf(page, source);
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result')).toContainText('smaller');
  const bytes = await download(page);
  expect(bytes.length).toBeLessThan(source.length);
  expect(await textOf(bytes)).toEqual(await textOf(source));
  const result = await PDFDocument.load(bytes);
  const annotations = result.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  expect(annotations.lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText())
    .toBe('https://example.org/synthetic-link');
  const compact = await pdfFixture({ compact: true });
  await choosePdf(page, compact);
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result')).toContainText('No size reduction achieved');
  expect(await download(page)).toEqual(compact);
  await page.getByRole('button', { name: 'Clear files', exact: true }).click();
  await selectTool(page, 'Organize Pages');
  await choosePdf(page, source);
  const originalPixels = await previewPixels(page);
  await choosePdf(page, bytes, 'structural-output.pdf');
  expect(await previewPixels(page)).toEqual(originalPixels);
});

test('image compression requires acknowledgement, reduces scans, preserves visible dimensions and renders nonblank output', async ({ page }) => {
  await selectTool(page, 'Compress PDF');
  const noise = await imageFixture(page, 'image/png', true);
  const doc = await PDFDocument.create(); const image = await doc.embedPng(noise);
  doc.addPage([240, 320]).drawImage(image, { x: 0, y: 0, width: 240, height: 320 });
  const rotated = doc.addPage([240, 320]); rotated.setRotation(degrees(90));
  rotated.drawImage(image, { x: 0, y: 0, width: 240, height: 320 });
  const original = Buffer.from(await doc.save());
  await choosePdf(page, original);
  await page.getByRole('radio', { name: 'Smaller file / image-based' }).check();
  await expect(page.getByRole('button', { name: 'Compress PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Balanced/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result')).toContainText('smaller');
  const output = await download(page);
  expect(output.length).toBeLessThan(original.length / 2);
  const result = await PDFDocument.load(output);
  expect(result.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle])).toEqual([[240, 320, 0], [320, 240, 0]]);
  expect(await textOf(output)).toEqual(['', '']);
  await page.getByRole('button', { name: 'Clear files', exact: true }).click();
  await selectTool(page, 'Organize Pages');
  await choosePdf(page, output);
  const renderedOutput = await previewPixels(page);
  expect(renderedOutput.filter((value, index) => index % 4 !== 3 && value < 200).length).toBeGreaterThan(1000);
  await choosePdf(page, original, 'original-scan.pdf');
  const renderedOriginal = await previewPixels(page);
  expect(renderedOutput.length).toBe(renderedOriginal.length);
  const meanDifference = renderedOutput.reduce((sum, value, index) =>
    sum + Math.abs(value - renderedOriginal[index]), 0) / renderedOutput.length;
  expect(meanDifference).toBeLessThan(35);
});

test('invalid, encrypted, excessive and unsupported inputs are explicit and do not alter accepted state', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles({ name: 'not-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('Unsupported image');
  await page.getByRole('button', { name: 'Clear files', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await selectTool(page, 'Compress PDF');
  await page.locator('input[type=file]').setInputFiles({ name: 'encrypted.pdf', mimeType: 'application/pdf', buffer: await pdfFixture({ encrypted: true }) });
  await expect(page.getByRole('alert')).toContainText('encrypted');
  await page.locator('input[type=file]').setInputFiles({ name: 'too-many.pdf', mimeType: 'application/pdf', buffer: await pdfFixture({ pages: 201 }) });
  await expect(page.getByRole('alert')).toContainText('200-page');
  const encoded = (await pdfFixture({ pages: 1 })).toString('base64');
  await page.locator('.file-picker').evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'one.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File([bytes], 'two.pdf', { type: 'application/pdf' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, encoded);
  await expect(page.getByRole('alert')).toContainText('one PDF');
  await expect(page.getByRole('button', { name: 'Compress PDF', exact: true })).toBeDisabled();
});

test('cancels expensive operations and clears all input, edits and results', async ({ page }) => {
  await selectTool(page, 'Compress PDF');
  await choosePdf(page, await pdfFixture({ pages: 100 }));
  await page.getByRole('radio', { name: 'Smaller file / image-based' }).check();
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel operation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Rendering page');
  await page.getByRole('button', { name: 'Clear files', exact: true }).click();
  await expect(page.getByText('synthetic-private.pdf', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compress PDF', exact: true })).toBeDisabled();
  await choosePdf(page, await pdfFixture({ pages: 1 }));
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Download/ })).toBeVisible();
});

test('is light by default, supports keyboard tabs and narrow layout, and reload discards files', async ({ page }) => {
  await expect(page.locator('footer')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('tab', { name: 'Images to PDF', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Compress PDF', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Compress PDF', exact: true })).toBeVisible();
  await choosePdf(page, await pdfFixture({ pages: 1 }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.unrouteAll({ behavior: 'wait' });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Images to PDF', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.file-list li')).toHaveCount(0);
  await expect(page.getByText('synthetic-private.pdf', { exact: true })).toHaveCount(0);
});

test('reset and discard protection still work after exhausting bounded undo history', async ({ page }) => {
  await selectTool(page, 'Organize Pages');
  await choosePdf(page, await pdfFixture({ pages: 1 }));
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  for (let i = 0; i < 21; i++) await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  for (let i = 0; i < 20; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByText('Added rotation: 90°', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await pdfFixture({ pages: 2 }) });
  await expect(page.locator('.pages > li')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset to original', exact: true }).click();
  await expect(page.getByText('Added rotation: 0°', { exact: true })).toBeVisible();
});
