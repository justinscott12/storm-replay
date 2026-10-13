import type { FetchStats, Frame, WorkerRequest, WorkerResponse } from './types';

export class ScanError extends Error {
  constructor(
    override readonly name: string,
    message: string,
  ) {
    super(message);
  }
}

/** Promise wrapper around the decode worker. */
export class RadarClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: { frame: Frame; stats: FetchStats }) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve({ frame: msg.frame, stats: msg.stats });
      else p.reject(new ScanError(msg.error.name, msg.error.message));
    };
  }

  load(url: string): Promise<{ frame: Frame; stats: FetchStats }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, url } satisfies WorkerRequest);
    });
  }
}
