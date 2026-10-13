import { Archive2Reader, type Scan } from './archive2';
import type { FetchStats } from '../types';

export class NetworkError extends Error {
  override name = 'NetworkError';
}

/**
 * Stream a scan from the bucket, gunzip on the fly if needed, and cancel the download as soon as
 * the decoder has the lowest REF + VEL sweeps. For a Moore-era .gz volume that's ~1.2 MB of 8 MB.
 */
export async function fetchScan(url: string, signal?: AbortSignal): Promise<{ scan: Scan; stats: FetchStats }> {
  const t0 = performance.now();
  const abort = new AbortController();
  signal?.addEventListener('abort', () => abort.abort(signal.reason), { once: true });

  let res: Response;
  try {
    res = await fetch(url, { signal: abort.signal });
  } catch (err) {
    if (abort.signal.aborted) throw err;
    throw new NetworkError(`Network request failed (${(err as Error).message})`);
  }
  if (!res.ok || !res.body) throw new NetworkError(`HTTP ${res.status} for ${url.split('/').pop()}`);
  const ttfbMs = performance.now() - t0;
  const length = Number(res.headers.get('content-length'));

  const raw = res.body.getReader();
  const first = await raw.read();
  const head = first.value ?? new Uint8Array(0);
  const isGzip = head.length >= 2 ? head[0] === 0x1f && head[1] === 0x8b : url.endsWith('.gz');
  let bytesDownloaded = head.length;
  const counted = new ReadableStream<Uint8Array>({
    start(c) {
      if (head.length) c.enqueue(head);
      if (first.done) c.close();
    },
    async pull(c) {
      const { done, value } = await raw.read();
      if (done) return c.close();
      bytesDownloaded += value.length;
      c.enqueue(value);
    },
    cancel(reason) {
      return raw.cancel(reason);
    },
  });
  const stream = isGzip ? counted.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>) : counted;

  const reader = stream.getReader();
  const archive = new Archive2Reader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (archive.push(value)) break;
    }
  } finally {
    // Stop the download: we have what we need (or failed).
    reader.cancel().catch(() => {});
    abort.abort();
  }

  return {
    scan: archive.finish(),
    stats: {
      bytesDownloaded,
      fileBytes: Number.isFinite(length) && length > 0 ? length : null,
      ttfbMs,
      totalMs: performance.now() - t0,
      decodeMs: archive.stats.decodeMs,
    },
  };
}
