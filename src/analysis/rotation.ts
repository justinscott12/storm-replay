// Rotation (velocity couplet) detection on the lowest-tilt base velocity.
//
// A tornadic or mesocyclonic vortex shows up as strong inbound (toward the radar) velocities right
// next to strong outbound ones at the same range. Looking out from the radar, a cyclonic
// (counter-clockwise, northern hemisphere) vortex has inbound on the left / anticlockwise side and
// outbound on the right. So we scan azimuthally along each range ring.
//
//   1. Dealias. Velocities beyond the Nyquist speed (about 26 m/s for VCP 12) wrap around, and a
//      violent couplet aliases into nonsense. Unfold along each radial using continuity from the
//      radar outward, seeding each radial from its neighbour, then fix leftover outliers against a
//      local median.
//   2. For each gate (5-150 km), look across an arc of at most ~2.5 km. Take the strongest inbound
//      and outbound values; if inbound is anticlockwise of outbound, Vrot = (out - in) / 2.
//   3. Keep candidates over threshold where reflectivity says there's a storm (>= 20 dBZ, which
//      kills most clutter and clear-air noise), whose inbound and outbound peaks are backed by
//      neighbouring gates, with a few supporting candidates nearby, and whose shear zone is compact
//      in range (long radial shear lines are dealiasing seams). Suppress non-maxima within 5 km.
//
// This is a simplified cousin of the NWS mesocyclone/TVS algorithms: one tilt, no time tracking.
// Thresholds: Vrot >= 20 m/s (~40 kt) moderate, >= 30 m/s (~58 kt) strong.

import type { Frame, FrameMoment, Rotation } from '../types';

export interface RotationOptions {
  minRangeKm: number;
  maxRangeKm: number;
  maxArcKm: number;
  moderateVrot: number;
  strongVrot: number;
  minDbz: number;
  separationKm: number;
  minSupport: number;
  maxResults: number;
  maxShearLengthKm: number;
}

export const DEFAULT_ROTATION_OPTIONS: RotationOptions = {
  minRangeKm: 10,
  maxRangeKm: 150,
  maxArcKm: 2.5,
  moderateVrot: 20,
  strongVrot: 30,
  minDbz: 20,
  separationKm: 5,
  minSupport: 4,
  maxResults: 6,
  maxShearLengthKm: 6,
};

const EARTH_R = 6371008.8;

/** Physical velocities (m/s) with NaN for no data, rows x gates. */
export function velocities(m: FrameMoment): Float32Array {
  const v = new Float32Array(m.grid.length);
  for (let i = 0; i < v.length; i++) {
    const c = m.grid[i]!;
    v[i] = c < 2 ? NaN : (c - m.offset) / m.scale;
  }
  return v;
}

/** In-place unfolding of aliased velocities. */
export function dealias(v: Float32Array, rows: number, gates: number, nyquist: number): void {
  if (!(nyquist > 0)) return;
  const twoVn = 2 * nyquist;
  const unfold = (x: number, ref: number) => x + twoVn * Math.round((ref - x) / twoVn);

  // Pass 1: radial continuity. Reference = mean of the last few unfolded gates on this radial,
  // falling back to the previous radial's value at this gate after a gap.
  const window = 4;
  for (let r = 0; r < rows; r++) {
    const prev = ((r + rows - 1) % rows) * gates;
    const row = r * gates;
    const recent: number[] = [];
    let gap = 0;
    for (let g = 0; g < gates; g++) {
      let x = v[row + g]!;
      if (Number.isNaN(x)) {
        if (++gap > 8) recent.length = 0;
        continue;
      }
      gap = 0;
      let ref = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : NaN;
      if (Number.isNaN(ref) && r > 0) ref = v[prev + g]!;
      if (!Number.isNaN(ref)) x = unfold(x, ref);
      v[row + g] = x;
      recent.push(x);
      if (recent.length > window) recent.shift();
    }
  }

  // Pass 2: anything still more than Vn from its 5x5 neighbourhood median gets folded toward it.
  const out = v.slice();
  const nb: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let g = 2; g < gates - 2; g++) {
      const x = v[r * gates + g]!;
      if (Number.isNaN(x)) continue;
      nb.length = 0;
      let sum = 0;
      for (let dr = -2; dr <= 2; dr++) {
        const rr = ((r + dr + rows) % rows) * gates;
        for (let dg = -2; dg <= 2; dg++) {
          const y = v[rr + g + dg]!;
          if (Number.isNaN(y)) continue;
          nb.push(y);
          sum += y;
        }
      }
      if (nb.length < 6) continue;
      // Cheap pre-check: a gate close to its neighbourhood mean is fine; only sort when it isn't.
      if (Math.abs(x - sum / nb.length) <= nyquist / 3) continue;
      nb.sort((a, b) => a - b);
      const med = nb[nb.length >> 1]!;
      if (Math.abs(x - med) > nyquist) out[r * gates + g] = unfold(x, med);
    }
  }
  v.set(out);
}

/** How many of a gate's 4 neighbours share its sign with at least half its magnitude. */
function coherent(v: Float32Array, rows: number, gates: number, row: number, gate: number, peak: number): number {
  let n = 0;
  const check = (r: number, g: number) => {
    if (g < 0 || g >= gates) return;
    const x = v[((r + rows) % rows) * gates + g]!;
    if (!Number.isNaN(x) && Math.sign(x) === Math.sign(peak) && Math.abs(x) >= Math.abs(peak) / 2) n++;
  };
  check(row - 1, gate);
  check(row + 1, gate);
  check(row, gate - 1);
  check(row, gate + 1);
  return n;
}

interface Candidate {
  vrot: number;
  row: number;
  gate: number;
  /** Rows between inbound and outbound maxima. */
  span: number;
}

export function detectRotation(frame: Frame, opts: RotationOptions = DEFAULT_ROTATION_OPTIONS): Rotation[] {
  const m = frame.vel;
  if (!m) return [];
  const { rows, gates, firstGateM, gateSpacingM } = m;
  const v = velocities(m);
  dealias(v, rows, gates, m.nyquistMs);

  // Reflectivity at the same range (REF and VEL gates can differ in count and start).
  const ref = frame.ref;
  const dbzAt = (row: number, rangeM: number): number => {
    const g = Math.round((rangeM - ref.firstGateM) / ref.gateSpacingM);
    if (g < 0 || g >= ref.gates) return -Infinity;
    const c = ref.grid[row * ref.gates + g]!;
    return c < 2 ? -Infinity : (c - ref.offset) / ref.scale;
  };

  const rowRad = (2 * Math.PI) / rows;
  const g0 = Math.max(0, Math.ceil((opts.minRangeKm * 1000 - firstGateM) / gateSpacingM));
  const g1 = Math.min(gates - 1, Math.floor((opts.maxRangeKm * 1000 - firstGateM) / gateSpacingM));
  const candidates: Candidate[] = [];
  for (let g = g0; g <= g1; g++) {
    const rangeM = firstGateM + g * gateSpacingM;
    const span = Math.max(1, Math.min(10, Math.round((opts.maxArcKm * 1000) / (rangeM * rowRad))));
    for (let r = 0; r < rows; r++) {
      let minV = Infinity;
      let minJ = -1;
      let maxV = -Infinity;
      let maxJ = -1;
      for (let j = 0; j <= span; j++) {
        const x = v[((r + j) % rows) * gates + g]!;
        if (Number.isNaN(x)) continue;
        if (x < minV) {
          minV = x;
          minJ = j;
        }
        if (x > maxV) {
          maxV = x;
          maxJ = j;
        }
      }
      // Cyclonic: inbound (negative) anticlockwise of outbound.
      if (minJ < 0 || minJ >= maxJ || minV > -5 || maxV < 5) continue;
      const vrot = (maxV - minV) / 2;
      if (vrot < opts.moderateVrot) continue;
      // Each maximum must be backed by its neighbours (same sign, at least half as strong):
      // isolated noisy or mis-unfolded gates don't make a vortex.
      if (coherent(v, rows, gates, (r + minJ) % rows, g, minV) < 3 || coherent(v, rows, gates, (r + maxJ) % rows, g, maxV) < 3) continue;
      const midRow = (r + Math.round((minJ + maxJ) / 2)) % rows;
      if (dbzAt(midRow, rangeM) < opts.minDbz) continue;
      candidates.push({ vrot, row: (r + (minJ + maxJ) / 2) % rows, gate: g, span: maxJ - minJ });
    }
  }

  const position = (c: Candidate) => {
    const rangeM = firstGateM + c.gate * gateSpacingM;
    const az = (c.row + 0.5) * rowRad;
    return { x: rangeM * Math.sin(az), y: rangeM * Math.cos(az), rangeM, az };
  };
  const pts = candidates.map((c) => ({ c, ...position(c) }));
  pts.sort((a, b) => b.c.vrot - a.c.vrot);

  const sep = opts.separationKm * 1000;
  const accepted: typeof pts = [];
  for (const p of pts) {
    if (accepted.length >= opts.maxResults) break;
    if (accepted.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < sep)) continue;
    // Support: other candidates within 3 km that are at least moderate.
    let support = 0;
    for (const q of pts) {
      if (q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 3000 && ++support >= opts.minSupport) break;
    }
    if (support < opts.minSupport) continue;
    // Compactness: a vortex's shear zone is a few km long in range. A long, straight shear line
    // along a radial is almost always a dealiasing seam (a patch unfolded by 2*Vn), not rotation.
    let near = Infinity;
    let far = -Infinity;
    for (const q of pts) {
      const across = Math.abs(Math.atan2(Math.sin(q.az - p.az), Math.cos(q.az - p.az))) * p.rangeM;
      if (across > 1500 || Math.abs(q.rangeM - p.rangeM) > 10_000) continue;
      near = Math.min(near, q.rangeM);
      far = Math.max(far, q.rangeM);
    }
    if (far - near > opts.maxShearLengthKm * 1000) continue;
    accepted.push(p);
  }

  const latRad = (frame.lat * Math.PI) / 180;
  return accepted.map(({ c, x, y, rangeM, az }) => ({
    lat: frame.lat + (y / EARTH_R) * (180 / Math.PI),
    lon: frame.lon + (x / (EARTH_R * Math.cos(latRad))) * (180 / Math.PI),
    rangeKm: rangeM / 1000,
    azimuthDeg: (az * 180) / Math.PI,
    vrotMs: c.vrot,
    diameterKm: (c.span * rowRad * rangeM) / 1000,
    strength: c.vrot >= opts.strongVrot ? 'strong' : 'moderate',
  }));
}
