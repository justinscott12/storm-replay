// Shapes shared between the decode worker and the UI. A Frame is what the renderer draws;
// it can come from a raw Archive II volume (explore mode) or, later, a preprocessed asset.

export type Product = 'REF' | 'VEL';

export interface FrameMoment {
  /** Gates per azimuth row (texture width). */
  gates: number;
  /** Azimuth rows (texture height); row i covers [i, i+1) * 360/rows degrees. */
  rows: number;
  firstGateM: number;
  gateSpacingM: number;
  /** physical = (code - offset) / scale; codes 0/1 are below-threshold / range-folded. */
  scale: number;
  offset: number;
  elevationDeg: number;
  grid: Uint8Array;
}

export interface Frame {
  station: string;
  lat: number;
  lon: number;
  /** UTC ms since epoch of the first radial. */
  time: number;
  vcp: number;
  ref: FrameMoment;
  vel: FrameMoment | null;
}

export interface FetchStats {
  /** Compressed bytes received before the download was cancelled. */
  bytesDownloaded: number;
  /** Full object size from Content-Length, when known. */
  fileBytes: number | null;
  ttfbMs: number;
  totalMs: number;
  /** CPU time in bzip2 + message parsing (gunzip runs in native DecompressionStream). */
  decodeMs: number;
}

export type WorkerRequest = { id: number; url: string };

export type WorkerResponse =
  | { id: number; ok: true; frame: Frame; stats: FetchStats }
  | { id: number; ok: false; error: { name: string; message: string } };
