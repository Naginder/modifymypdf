import type { Job, JobResult, WorkerResponse } from './model';
import WritingWorker from '../workers/pdf.worker.ts?worker&inline';

export class PdfWorker {
  private worker = new WritingWorker();
  private abort: () => void;
  constructor(private signal: AbortSignal, private progress: (message: string) => void) {
    this.abort = () => this.worker.terminate();
    signal.addEventListener('abort', this.abort, { once: true });
  }

  run(job: Job): Promise<JobResult> {
    this.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
      const cleanup = () => {
        this.signal.removeEventListener('abort', abort);
        this.worker.onmessage = null;
        this.worker.onerror = null;
      };
      this.signal.addEventListener('abort', abort, { once: true });
      this.worker.onerror = (event) => {
        event.preventDefault();
        cleanup();
        reject(new Error('The PDF worker could not complete the operation. Try a smaller file or reload the page.'));
      };
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'progress') this.progress(event.data.message);
        else {
          cleanup();
          if (event.data.type === 'error') reject(new Error(event.data.message));
          else resolve(event.data.result);
        }
      };
      this.worker.postMessage(job);
    });
  }

  dispose(): void {
    this.signal.removeEventListener('abort', this.abort);
    this.worker.terminate();
  }
}
