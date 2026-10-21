type PendingJob = { resolve: (release: () => void) => void; reject: (cause: Error) => void; signal?: AbortSignal; abort: () => void };

/** A process-wide budget shared by texture transcodes, picking trees and modelling workers. */
export class GraphicsJobBudget {
  private running = 0;
  private waiting: PendingJob[] = [];
  constructor(private limit: number, private capacity = 64) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid graphics job budget.');
  }
  get usage() { return { running: this.running, waiting: this.waiting.length, limit: this.limit }; }
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled graphics job.', 'AbortError'));
    if (this.waiting.length >= this.capacity) return Promise.reject(new Error('Graphics job queue is full.'));
    return new Promise((resolve, reject) => {
      const pending: PendingJob = { resolve, reject, signal, abort: () => {
        this.waiting = this.waiting.filter(value => value !== pending);
        reject(new DOMException('Cancelled graphics job.', 'AbortError'));
      } };
      signal?.addEventListener('abort', pending.abort, { once: true });
      this.waiting.push(pending); this.pump();
    });
  }
  private pump() {
    while (this.running < this.limit && this.waiting.length) {
      const pending = this.waiting.shift()!;
      pending.signal?.removeEventListener('abort', pending.abort);
      this.running++;
      let released = false;
      pending.resolve(() => { if (released) return; released = true; this.running--; this.pump(); });
    }
  }
}

let shared: GraphicsJobBudget | undefined;
function budget() { return shared ??= new GraphicsJobBudget(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1 : 2); }
export const acquireGraphicsJob = (signal?: AbortSignal) => budget().acquire(signal);
export const graphicsJobUsage = () => budget().usage;
