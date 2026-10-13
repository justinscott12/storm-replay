import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { detectRotation } from '../src/analysis/rotation';
import { formatHash, parseHash } from '../src/app/route';
import { parseKey } from '../src/data/bucket';
import { packFrame, unpackFrame } from '../src/data/packed';
import { Lru } from '../src/player/lru';
import { associate, slice } from '../src/render/overlays';

const storms = join(__dirname, '..', 'public', 'storms');
const frameAt = (storm: string, hhmmss: string) => unpackFrame(gunzipSync(readFileSync(join(storms, storm, `${hhmmss}.srf`))));
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));

describe('share links', () => {
  it('round-trips station, time and product', () => {
    const r = parseHash('#KTLX/2013-05-20T19:55Z/vel')!;
    expect(r).toEqual({ station: 'KTLX', time: Date.UTC(2013, 4, 20, 19, 55), product: 'VEL' });
    expect(formatHash(r)).toBe('#KTLX/2013-05-20T19:55Z/vel');
  });
  it('defaults to reflectivity and accepts lowercase / seconds', () => {
    expect(parseHash('ktlx/2013-05-20T19:55:27Z')).toMatchObject({ station: 'KTLX', product: 'REF' });
  });
  it('rejects junk', () => {
    for (const h of ['', '#', '#KTLX', '#KTLX/yesterday', '#KTLX/2013-13-45T99:99Z']) expect(parseHash(h)).toBeNull();
  });
});

describe('bucket keys', () => {
  it('parses volume keys and skips metadata files', () => {
    expect(parseKey('2013/05/20/KTLX/KTLX20130520_195527_V06.gz')).toMatchObject({ station: 'KTLX', time: Date.UTC(2013, 4, 20, 19, 55, 27) });
    expect(parseKey('2026/06/06/KPBZ/KPBZ20260606_030522_V06')).not.toBeNull();
    expect(parseKey('2026/06/06/KPBZ/KPBZ20260606_005555_V06_MDM')).toBeNull();
  });
});

describe('LRU', () => {
  it('evicts the least recently used entry', () => {
    const evicted: string[] = [];
    const lru = new Lru<string, number>(2, (k) => evicted.push(k));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect([...lru.keys()]).toEqual(['a', 'c']);
  });
});

describe('packed frames', () => {
  it('round-trips a frame byte for byte', () => {
    const f = frameAt('moore-2013', '201643');
    const again = unpackFrame(packFrame(f));
    expect(again.time).toBe(f.time);
    expect(Buffer.from(again.vel!.grid).equals(Buffer.from(f.vel!.grid))).toBe(true);
  });
});

describe('overlays', () => {
  it('slices a path by length fraction', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    expect(slice(line, 0)).toEqual([]);
    expect(slice(line, 1)).toEqual(line);
    const half = slice(line, 0.75);
    expect(half[half.length - 1]![0]).toBeCloseTo(1.5, 6);
  });
  it('marks detections that persist from the previous scan', () => {
    const a = { lat: 35.3, lon: -97.5, rangeKm: 20, azimuthDeg: 250, vrotMs: 40, diameterKm: 1, strength: 'strong' as const };
    const moved = { ...a, lon: -97.45 }; // ~4.5 km east
    const far = { ...a, lat: 36 };
    expect(associate([moved, far], [a]).map((r) => r.persistent)).toEqual([true, false]);
    expect(associate([a], null)[0]!.persistent).toBe(false);
  });
});

describe('rotation detection', () => {
  // SPC: Moore EF5 began 19:56 UTC at 35.284,-97.628 and ended 20:35 at 35.341,-97.400.
  const mooreStart = { lat: 35.284, lon: -97.628 };

  it('finds the Moore couplet at touchdown, within 2 km of the surveyed start', () => {
    const [top] = detectRotation(frameAt('moore-2013', '195527'));
    expect(top).toBeDefined();
    expect(km(top!, mooreStart)).toBeLessThan(2);
  });

  it('tracks it east through Moore as a strong couplet', () => {
    const top = detectRotation(frameAt('moore-2013', '201643'))[0]!;
    expect(top.strength).toBe('strong');
    expect(top.vrotMs).toBeGreaterThan(50);
    // On the surveyed path: between the start and end longitudes, near the path latitude.
    expect(top.lon).toBeGreaterThan(-97.628);
    expect(top.lon).toBeLessThan(-97.4);
    expect(Math.abs(top.lat - 35.32)).toBeLessThan(0.03);
  });

  it('stays quiet before the storm organises', () => {
    for (const t of ['193405', '193821', '194238']) expect(detectRotation(frameAt('moore-2013', t))).toEqual([]);
  });

  it('every committed storm frame decodes and runs the detector', () => {
    for (const storm of readdirSync(storms)) {
      for (const f of readdirSync(join(storms, storm)).filter((n) => n.endsWith('.srf'))) {
        expect(() => detectRotation(frameAt(storm, f.replace('.srf', '')))).not.toThrow();
      }
    }
  });
});
