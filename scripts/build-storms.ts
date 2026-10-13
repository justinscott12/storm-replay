// Preprocess the curated storms into small static assets (run: npm run build:storms).
//
// For each storm: list the bucket window, download each volume (cached in .cache/raw), decode
// the lowest tilt with the same decoder the browser uses, crop to 300 km, pack to the SRF1 format,
// and gzip. Writes public/storms/<id>/<HHMMSS>.srf + manifest.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { listRange } from '../src/data/bucket';
import { packFrame } from '../src/data/packed';
import { STORMS, type StormManifest } from '../src/data/storms';
import { Archive2Reader } from '../src/decoder/archive2';
import { cropMoment, scanToFrame } from '../src/decoder/frame';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const CACHE = join(ROOT, '.cache', 'raw');
const MAX_RANGE_M = 300_000;
// The reflectivity palette is transparent below 5 dBZ, so those gates are pure noise to the
// viewer. Zeroing them cuts ~20% of the compressed size without changing a visible pixel.
const MIN_VISIBLE_DBZ = 5;
mkdirSync(CACHE, { recursive: true });

async function download(url: string): Promise<Uint8Array> {
  const file = join(CACHE, url.split('/').pop()!);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

const only = process.argv.slice(2);
for (const storm of STORMS.filter((s) => only.length === 0 || only.includes(s.id))) {
  const outDir = join(ROOT, 'public', 'storms', storm.id);
  mkdirSync(outDir, { recursive: true });
  const scans = await listRange(storm.station, Date.parse(storm.start), Date.parse(storm.end));
  console.log(`${storm.id}: ${scans.length} scans`);

  const manifest: StormManifest = { id: storm.id, station: storm.station, frames: [], overlays: { warnings: null, track: null } };
  const manifestPath = join(outDir, 'manifest.json');
  if (existsSync(manifestPath)) manifest.overlays = (JSON.parse(readFileSync(manifestPath, 'utf8')) as StormManifest).overlays;

  let total = 0;
  for (const scan of scans) {
    let bytes = await download(scan.url);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
    const reader = new Archive2Reader();
    reader.push(bytes);
    const frame = scanToFrame(reader.finish());
    frame.ref = cropMoment(frame.ref, MAX_RANGE_M);
    if (frame.vel) frame.vel = cropMoment(frame.vel, MAX_RANGE_M);
    const minCode = Math.ceil(MIN_VISIBLE_DBZ * frame.ref.scale + frame.ref.offset);
    const grid = frame.ref.grid;
    for (let i = 0; i < grid.length; i++) if (grid[i]! < minCode) grid[i] = 0;
    const packed = gzipSync(packFrame(frame), { level: 9 });
    const name = `${new Date(scan.time).toISOString().slice(11, 19).replaceAll(':', '')}.srf`;
    writeFileSync(join(outDir, name), packed);
    manifest.frames.push({ time: frame.time, file: name, bytes: packed.length });
    total += packed.length;
    console.log(`  ${name}  ${(packed.length / 1024).toFixed(0)} KB  (raw volume ${(scan.url.endsWith('.gz') ? 'gz' : 'raw')})`);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`  total ${(total / 1e6).toFixed(2)} MB, avg ${(total / scans.length / 1024).toFixed(0)} KB/frame`);
}
