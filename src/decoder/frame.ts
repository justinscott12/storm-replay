import type { Scan, Sweep } from './archive2';
import { GRID_ROWS, toAzimuthGrid } from './grid';
import type { Frame, FrameMoment } from '../types';

export function toMoment(s: Sweep): FrameMoment {
  return {
    gates: s.gates,
    rows: GRID_ROWS,
    firstGateM: s.firstGateM,
    gateSpacingM: s.gateSpacingM,
    scale: s.scale,
    offset: s.offset,
    elevationDeg: s.elevationDeg,
    nyquistMs: s.nyquistMs,
    grid: toAzimuthGrid(s),
  };
}

export function scanToFrame(scan: Scan): Frame {
  return {
    station: scan.station,
    lat: scan.lat,
    lon: scan.lon,
    time: scan.time,
    vcp: scan.vcp,
    ref: toMoment(scan.ref),
    vel: scan.vel ? toMoment(scan.vel) : null,
    rotations: [],
  };
}

/** Drop gates beyond maxRangeM (curated storms don't need the far 160 km). */
export function cropMoment(m: FrameMoment, maxRangeM: number): FrameMoment {
  const gates = Math.min(m.gates, Math.max(1, Math.ceil((maxRangeM - m.firstGateM) / m.gateSpacingM)));
  if (gates === m.gates) return m;
  const grid = new Uint8Array(m.rows * gates);
  for (let r = 0; r < m.rows; r++) grid.set(m.grid.subarray(r * m.gates, r * m.gates + gates), r * gates);
  return { ...m, gates, grid };
}
