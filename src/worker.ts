/// <reference lib="webworker" />
// Decode worker: everything heavy happens here, off the main thread. Fetch + decompress + parse
// (raw Archive II) or unpack (preprocessed .srf), then rotation detection, then hand the UI
// ready-to-upload texture grids (transferred, not copied).
import { detectRotation } from './analysis/rotation';
import { unpackFrame } from './data/packed';
import { fetchScan } from './decoder/fetchScan';
import { scanToFrame } from './decoder/frame';
import type { FetchStats, Frame, WorkerRequest, WorkerResponse } from './types';

declare const self: DedicatedWorkerGlobalScope;

async function loadPacked(url: string): Promise<{ frame: Frame; stats: FetchStats }> {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').pop()}`);
  const ttfbMs = performance.now() - t0;
  let bytes = new Uint8Array(await res.arrayBuffer());
  const downloaded = bytes.length;
  const t1 = performance.now();
  // Gzipped at build time. (If a server already undid the gzip, the magic bytes say so.)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const frame = unpackFrame(bytes);
  return {
    frame,
    stats: { kind: 'packed', bytesDownloaded: downloaded, fileBytes: downloaded, ttfbMs, totalMs: 0, decodeMs: performance.now() - t1 },
  };
}

async function loadArchive(url: string): Promise<{ frame: Frame; stats: FetchStats }> {
  const { scan, stats } = await fetchScan(url);
  const t0 = performance.now();
  const frame = scanToFrame(scan);
  stats.decodeMs += performance.now() - t0;
  return { frame, stats };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, kind, url } = e.data;
  const t0 = performance.now();
  try {
    const { frame, stats } = kind === 'packed' ? await loadPacked(url) : await loadArchive(url);
    const t1 = performance.now();
    frame.rotations = detectRotation(frame);
    stats.rotationMs = performance.now() - t1;
    stats.totalMs = performance.now() - t0;
    const reply: WorkerResponse = { id, ok: true, frame, stats };
    self.postMessage(reply, [frame.ref.grid.buffer, ...(frame.vel ? [frame.vel.grid.buffer] : [])]);
  } catch (err) {
    const { name, message } = err as Error;
    const reply: WorkerResponse = { id, ok: false, error: { name, message } };
    self.postMessage(reply);
  }
};
