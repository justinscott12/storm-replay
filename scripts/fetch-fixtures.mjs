// Downloads the real radar volumes the unit tests decode. They're public NOAA data but too big
// to commit (8 MB + 7 MB), so they live in test/fixtures/ (gitignored).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'https://unidata-nexrad-level2.s3.amazonaws.com';
const KEYS = [
  '2013/05/20/KTLX/KTLX20130520_195527_V06.gz', // Moore EF5, gzip-wrapped, uncompressed inside
  '2026/06/06/KPBZ/KPBZ20260606_030522_V06', // Pittsburgh, raw, bzip2 LDM records
];

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
mkdirSync(dir, { recursive: true });
for (const key of KEYS) {
  const out = join(dir, key.split('/').pop());
  if (existsSync(out)) {
    console.log(`have ${out}`);
    continue;
  }
  const res = await fetch(`${BUCKET}/${key}`);
  if (!res.ok) throw new Error(`${res.status} fetching ${key}`);
  writeFileSync(out, new Uint8Array(await res.arrayBuffer()));
  console.log(`saved ${out}`);
}
