import type { Sweep } from './archive2';

/** Azimuth rows in the GPU texture: 0.5 degree bins, matching super-resolution radials. */
export const GRID_ROWS = 720;

/**
 * Resample a sweep onto fixed azimuth bins so the shader can index a texture directly by angle:
 * row i covers [i, i+1) * 360/rows degrees and takes the nearest radial. Radials arrive in
 * collection order starting at an arbitrary azimuth, at 0.5 or 1 degree spacing, so this also
 * normalises legacy-resolution sweeps. Bins with no radial within 1 degree stay 0 (no data).
 */
export function toAzimuthGrid(sweep: Sweep, rows = GRID_ROWS): Uint8Array {
  const { radials, gates, azimuths, data } = sweep;
  const grid = new Uint8Array(rows * gates);
  if (radials === 0) return grid;

  const order = Array.from({ length: radials }, (_, i) => i).sort((a, b) => azimuths[a]! - azimuths[b]!);
  const binDeg = 360 / rows;
  let k = 0;
  for (let row = 0; row < rows; row++) {
    const centre = (row + 0.5) * binDeg;
    // Advance to the last radial at or before this bin's centre (sorted, so a moving pointer).
    while (k + 1 < radials && azimuths[order[k + 1]!]! <= centre) k++;
    // Candidates: that radial, the next one, and the wrap-around neighbours at 0/360.
    let best = -1;
    let bestDist = 1.0001;
    for (const idx of [order[k]!, order[(k + 1) % radials]!, order[radials - 1]!, order[0]!]) {
      let d = Math.abs(azimuths[idx]! - centre);
      if (d > 180) d = 360 - d;
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    }
    if (best >= 0) grid.set(data.subarray(best * gates, (best + 1) * gates), row * gates);
  }
  return grid;
}
