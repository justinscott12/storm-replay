import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { listRange } from '../src/data/bucket';
import { Archive2Reader } from '../src/decoder/archive2';
import { scanToFrame } from '../src/decoder/frame';
import { detectRotation } from '../src/analysis/rotation';
const cache = '.cache/raw'; mkdirSync(cache, { recursive: true });
// Survey a station/time window: max reflectivity and rotation detections per scan. Helps pick
// storyboard windows. Usage: vite-node scripts/survey.ts KTLX 2013-05-20T19:00Z 2013-05-20T21:00Z
const [station, from, to] = process.argv.slice(2);
const scans = await listRange(station!, Date.parse(from!), Date.parse(to!));
for (const s of scans) {
  const f = `${cache}/${s.key.split('/').pop()}`;
  if (!existsSync(f)) writeFileSync(f, new Uint8Array(await (await fetch(s.url)).arrayBuffer()));
  const r = new Archive2Reader(); r.push(new Uint8Array(readFileSync(f)));
  const fr = scanToFrame(r.finish());
  const m = fr.ref; let n50 = 0, mx = -99;
  for (let i = 0; i < m.rows; i++) for (let g = 0; g < Math.min(m.gates, 600); g++) { const c = m.grid[i*m.gates+g]!; if (c < 2) continue; const v = (c-m.offset)/m.scale; if (v >= 50) n50++; if (v > mx) mx = v; }
  const rots = detectRotation(fr);
  console.log(new Date(s.time).toISOString().slice(11,19), 'vcp', fr.vcp, 'max', mx.toFixed(0), 'n50', n50, rots.map(x => `${x.strength[0]}${x.vrotMs.toFixed(0)}@${x.lat.toFixed(3)},${x.lon.toFixed(3)}`).join(' '));
}
