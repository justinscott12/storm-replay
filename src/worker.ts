/// <reference lib="webworker" />
// Decode worker: fetch + decompress + parse off the main thread, then hand the UI ready-to-upload
// texture grids (transferred, not copied).
import type { Sweep } from './decoder/archive2';
import { fetchScan } from './decoder/fetchScan';
import { GRID_ROWS, toAzimuthGrid } from './decoder/grid';
import type { FrameMoment, WorkerRequest, WorkerResponse } from './types';

declare const self: DedicatedWorkerGlobalScope;

const toMoment = (s: Sweep): FrameMoment => ({
  gates: s.gates,
  rows: GRID_ROWS,
  firstGateM: s.firstGateM,
  gateSpacingM: s.gateSpacingM,
  scale: s.scale,
  offset: s.offset,
  elevationDeg: s.elevationDeg,
  grid: toAzimuthGrid(s),
});

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, url } = e.data;
  let reply: WorkerResponse;
  try {
    const { scan, stats } = await fetchScan(url);
    const t0 = performance.now();
    const ref = toMoment(scan.ref);
    const vel = scan.vel ? toMoment(scan.vel) : null;
    stats.decodeMs += performance.now() - t0;
    reply = {
      id,
      ok: true,
      frame: { station: scan.station, lat: scan.lat, lon: scan.lon, time: scan.time, vcp: scan.vcp, ref, vel },
      stats,
    };
    self.postMessage(reply, [ref.grid.buffer, ...(vel ? [vel.grid.buffer] : [])]);
  } catch (err) {
    const { name, message } = err as Error;
    reply = { id, ok: false, error: { name, message } };
    self.postMessage(reply);
  }
};
