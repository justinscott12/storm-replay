import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Archive2Reader, DecodeError, UnsupportedFormatError, decodeArchive2, type Scan, type Sweep } from '../src/decoder/archive2';
import { bunzip2 } from '../src/decoder/bzip2';
import { GRID_ROWS, toAzimuthGrid } from '../src/decoder/grid';

const fixtures = join(__dirname, 'fixtures');
const KTLX = join(fixtures, 'KTLX20130520_195527_V06.gz');
const KPBZ = join(fixtures, 'KPBZ20260606_030522_V06');
const haveFixtures = existsSync(KTLX) && existsSync(KPBZ);
if (!haveFixtures) console.warn('Radar fixtures missing: run `npm run fixtures` to enable the real-file tests.');

interface OracleSweep {
  rays: number;
  valid_gates: number;
  first_gate_m: number;
  gate_spacing_m: number;
  elevation: number;
  samples: { ray: number; gate: number; value: number; az: number }[];
}
interface Oracle {
  lat: number;
  lon: number;
  time_units: string;
  vcp: number;
  REF: OracleSweep;
  VEL: OracleSweep;
}

const oracle = (name: string): Oracle => JSON.parse(readFileSync(join(__dirname, 'oracle', name), 'utf8')) as Oracle;
// toEqual on multi-megabyte typed arrays is very slow; compare bytes directly.
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
const physical = (s: Sweep, ray: number, gate: number): number | null => {
  const code = s.data[ray * s.gates + gate]!;
  return code < 2 ? null : (code - s.offset) / s.scale;
};

function checkAgainstOracle(scan: Scan, o: Oracle): void {
  expect(scan.lat).toBeCloseTo(o.lat, 4);
  expect(scan.lon).toBeCloseTo(o.lon, 4);
  expect(scan.vcp).toBe(o.vcp);
  const pyStart = Date.parse(o.time_units.replace('seconds since ', ''));
  expect(Math.abs(scan.time - pyStart)).toBeLessThan(60_000);
  for (const [sweep, ref] of [
    [scan.ref, o.REF],
    [scan.vel!, o.VEL],
  ] as const) {
    expect(sweep.radials).toBe(ref.rays);
    expect(sweep.firstGateM).toBe(ref.first_gate_m);
    expect(sweep.gateSpacingM).toBe(ref.gate_spacing_m);
    for (const s of ref.samples) {
      expect(sweep.azimuths[s.ray]).toBeCloseTo(s.az, 3);
      expect(physical(sweep, s.ray, s.gate)).toBeCloseTo(s.value, 3);
    }
    let valid = 0;
    for (const c of sweep.data) if (c >= 2) valid++;
    expect(valid).toBe(ref.valid_gates);
  }
}

describe.runIf(haveFixtures)('Archive II decoder vs Py-ART', () => {
  it('decodes KTLX 2013-05-20 19:55 (gzip-wrapped, uncompressed messages)', () => {
    const scan = decodeArchive2(gunzipSync(readFileSync(KTLX)));
    expect(scan.station).toBe('KTLX');
    expect(scan.vel).not.toBeNull();
    checkAgainstOracle(scan, oracle('ktlx_195527.json'));
  });

  it('decodes KPBZ 2026-06-06 03:05 (raw, bzip2 LDM records)', () => {
    const scan = decodeArchive2(new Uint8Array(readFileSync(KPBZ)));
    expect(scan.station).toBe('KPBZ');
    checkAgainstOracle(scan, oracle('kpbz_030522.json'));
  });

  it('stops early and gives identical output when fed in small chunks', () => {
    const file = gunzipSync(readFileSync(KTLX));
    const whole = decodeArchive2(file);
    const reader = new Archive2Reader();
    let fed = 0;
    for (let p = 0; p < file.length; p += 65_536) {
      fed = Math.min(file.length, p + 65_536);
      if (reader.push(file.subarray(p, fed))) break;
    }
    expect(fed).toBeLessThan(file.length * 0.25);
    const chunked = reader.finish();
    expect(sameBytes(chunked.ref.data, whole.ref.data)).toBe(true);
    expect(sameBytes(chunked.vel!.data, whole.vel!.data)).toBe(true);
  });

  it('builds a 0.5-degree azimuth grid where every bin has data', () => {
    const scan = decodeArchive2(gunzipSync(readFileSync(KTLX)));
    const grid = toAzimuthGrid(scan.ref);
    expect(grid.length).toBe(GRID_ROWS * scan.ref.gates);
    // The radial nearest 90.25 deg should land in row 180.
    const az = Array.from(scan.ref.azimuths);
    const nearest = az.reduce((best, a, i) => (Math.abs(a - 90.25) < Math.abs(az[best]! - 90.25) ? i : best), 0);
    const g = scan.ref.gates;
    expect(sameBytes(grid.subarray(180 * g, 181 * g), scan.ref.data.subarray(nearest * g, (nearest + 1) * g))).toBe(true);
  });
});

describe('bzip2', () => {
  const hasBzip2 = (() => {
    try {
      execFileSync('bzip2', ['--help'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.runIf(hasBzip2)('round-trips data compressed by the reference bzip2', () => {
    const text = new TextEncoder().encode('Moore, Oklahoma '.repeat(5000) + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.repeat(300));
    const noise = new Uint8Array(300_000).map((_, i) => (i * 2654435761) >>> 24);
    for (const input of [text, noise, new Uint8Array([7])]) {
      const compressed = new Uint8Array(execFileSync('bzip2', ['-c', '-9'], { input }));
      expect(sameBytes(bunzip2(compressed), input)).toBe(true);
    }
  });

  it('rejects data without a bzip2 header', () => {
    expect(() => bunzip2(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/BZh/);
  });
});

describe('format errors', () => {
  it('reports legacy ARCHIVE2 files as unsupported', () => {
    const legacy = new TextEncoder().encode('ARCHIVE2.001' + '\0'.repeat(40));
    expect(() => decodeArchive2(legacy)).toThrow(UnsupportedFormatError);
  });

  it('rejects non-radar data', () => {
    expect(() => decodeArchive2(new TextEncoder().encode('<html>not radar</html>'.repeat(4)))).toThrow(DecodeError);
  });
});
