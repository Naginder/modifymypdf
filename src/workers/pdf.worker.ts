import { PDFDocument } from 'pdf-lib';
import { imagesPdf, loadPdf, mergePdfs, organizePdf, savePdf } from '../lib/pdf';
import { failure, LIMITS } from '../lib/model';
import type { Job, JobResult, WorkerResponse } from '../lib/model';

let raster: PDFDocument | undefined;
let rasterBytes = 0;
const send = (response: WorkerResponse) => self.postMessage(response);

self.onmessage = async (event: MessageEvent<Job>) => {
  const job = event.data;
  const progress = (message: string) => send({ type: 'progress', message });
  try {
    let result: JobResult = {};
    switch (job.kind) {
      case 'inspect': result = { pages: (await loadPdf(job.bytes)).getPageCount() }; break;
      case 'images': result = { bytes: await imagesPdf(job.images, job.paper, progress) }; break;
      case 'merge': result = { bytes: await mergePdfs(job.sources, progress) }; break;
      case 'organize': result = { bytes: await organizePdf(job.bytes, job.pages) }; break;
      case 'optimize': result = { bytes: await savePdf(await loadPdf(job.bytes)) }; break;
      case 'raster-start': raster = await PDFDocument.create(); rasterBytes = 0; break;
      case 'raster-add': {
        if (!raster || raster.getPageCount() >= LIMITS.pages) throw new Error('The image-based operation exceeds the page limit.');
        rasterBytes += job.bytes.length;
        if (rasterBytes > LIMITS.totalBytes) throw new Error('Rendered images exceed 60 MB. Choose a lower quality preset or fewer pages.');
        const image = await raster.embedJpg(job.bytes);
        raster.addPage([job.width, job.height]).drawImage(image, { x: 0, y: 0, width: job.width, height: job.height });
        break;
      }
      case 'raster-save':
        if (!raster) throw new Error('No rendered pages are available.');
        result = { bytes: await savePdf(raster) }; raster = undefined; break;
    }
    if (result.bytes) self.postMessage({ type: 'result', result } satisfies WorkerResponse, { transfer: [result.bytes.buffer] });
    else send({ type: 'result', result });
  } catch (error) {
    send({ type: 'error', message: failure(error) });
  }
};
