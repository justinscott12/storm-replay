import type { FrameMoment, Product } from '../types';

type Stop = [value: number, rgb: number];

// NWS reflectivity scale (the classic RIDGE palette): one colour per 5 dBZ step from 5 dBZ.
// Below 5 dBZ is left transparent so the basemap shows through clear air.
const REF_STEPS: Stop[] = [
  [5, 0x04e9e7],
  [10, 0x019ff4],
  [15, 0x0300f4],
  [20, 0x02fd02],
  [25, 0x01c501],
  [30, 0x008e00],
  [35, 0xfdf802],
  [40, 0xe5bc00],
  [45, 0xfd9500],
  [50, 0xfd0000],
  [55, 0xd40000],
  [60, 0xbc0000],
  [65, 0xf800fd],
  [70, 0x9854c6],
  [75, 0xfdfdfd],
];

// Base velocity: green toward the radar (negative), red away, grey near zero; interpolated.
const VEL_STOPS: Stop[] = [
  [-40, 0x00e0ff],
  [-30, 0x00fb90],
  [-20, 0x00bb00],
  [-10, 0x007a00],
  [-2, 0x2f5b2f],
  [0, 0x6e6e6e],
  [2, 0x5b2f2f],
  [10, 0x8b0000],
  [20, 0xcd0000],
  [30, 0xff2a3c],
  [40, 0xffc000],
];
const RANGE_FOLDED = 0x77007d;

type Rgba = [number, number, number, number];
const rgba = (c: number): Rgba => [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255];

function stepColor(v: number): Rgba {
  let hit: Stop | undefined;
  for (const s of REF_STEPS) if (v >= s[0]) hit = s;
  return hit ? rgba(hit[1]) : [0, 0, 0, 0];
}

function rampColor(v: number): Rgba {
  const first = VEL_STOPS[0]!;
  const last = VEL_STOPS[VEL_STOPS.length - 1]!;
  if (v <= first[0]) return rgba(first[1]);
  if (v >= last[0]) return rgba(last[1]);
  for (let i = 1; i < VEL_STOPS.length; i++) {
    const [v1, c1] = VEL_STOPS[i]!;
    const [v0, c0] = VEL_STOPS[i - 1]!;
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0);
      const a = rgba(c0);
      const b = rgba(c1);
      return [0, 1, 2, 3].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as Rgba;
    }
  }
  return [0, 0, 0, 0];
}

/** 256-entry RGBA lookup from raw gate code to colour, so the shader never decodes values. */
export function buildLut(product: Product, m: Pick<FrameMoment, 'scale' | 'offset'>): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let code = 2; code < 256; code++) {
    const v = (code - m.offset) / m.scale;
    lut.set(product === 'REF' ? stepColor(v) : rampColor(v), code * 4);
  }
  if (product === 'VEL') lut.set(rgba(RANGE_FOLDED), 4);
  return lut;
}

/** Colour stops for drawing a legend. */
export function legendStops(product: Product): { value: number; css: string }[] {
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  return (product === 'REF' ? REF_STEPS : VEL_STOPS).map(([value, c]) => ({ value, css: hex(c) }));
}
