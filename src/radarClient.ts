import type { FetchStats, Frame, WorkerRequest, WorkerResponse } from './types';

export class ScanError extends Error {
  constructor(
    override readonly name: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Loaded {
  frame: Frame;
  stats: FetchStats;
}

type Pending = { resolve: (v: Loaded) => void; reject: (e: Error) => void };

/**
 * A small pool of decode workers. Each request goes to the least-busy worker, so a slow bzip2
 * frame doesn't block the next frame's download.
 */
export class RadarClient {
  private workers: { worker: Worker; busy: number }[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending & { slot: { busy: number } }>();

  constructor(size = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const slot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.settle(e.data);
      this.workers.push(slot);
    }
  }

  private settle(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    p.slot.busy--;
    if (msg.ok) p.resolve({ frame: msg.frame, stats: msg.stats });
    else p.reject(new ScanError(msg.error.name, msg.error.message));
  }

  load(kind: WorkerRequest['kind'], url: string): Promise<Loaded> {
    const id = this.nextId++;
    const slot = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    slot.busy++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ id, kind, url } satisfies WorkerRequest);
    });
  }
}
