// Listing scans in the public NOAA NEXRAD Level II archive (Unidata's AWS Open Data bucket).
// It sends `Access-Control-Allow-Origin: *`, so the browser can list and fetch it with no backend.

export const BUCKET = 'https://unidata-nexrad-level2.s3.amazonaws.com';

export interface ScanRef {
  station: string;
  key: string;
  url: string;
  /** Volume start time from the file name, UTC ms. */
  time: number;
}

const KEY_RE = /<Key>([^<]+)<\/Key>/g;
const NAME_RE = /^([A-Z0-9]{4})(\d{8})_(\d{6})(?:_V\d{2})?(\.gz)?$/;

/** Parse a scan key like `2013/05/20/KTLX/KTLX20130520_195527_V06.gz`. Skips _MDM and other non-volume files. */
export function parseKey(key: string): ScanRef | null {
  const name = key.split('/').pop() ?? '';
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, station, d, t] = m as unknown as [string, string, string, string];
  const time = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  return { station, key, url: `${BUCKET}/${key}`, time };
}

const dayPrefix = (station: string, day: Date) =>
  `${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${String(day.getUTCDate()).padStart(2, '0')}/${station}/`;

/** All volume scans for one station on one UTC day, oldest first. */
export async function listDay(station: string, day: Date, fetchImpl: typeof fetch = fetch): Promise<ScanRef[]> {
  const prefix = dayPrefix(station, day);
  const out: ScanRef[] = [];
  let token: string | null = null;
  do {
    const params = new URLSearchParams({ 'list-type': '2', prefix });
    if (token) params.set('continuation-token', token);
    const res = await fetchImpl(`${BUCKET}/?${params}`);
    if (!res.ok) throw new Error(`Listing ${prefix} failed: HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(KEY_RE)) {
      const ref = parseKey(m[1]!);
      if (ref) out.push(ref);
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? null) : null;
  } while (token);
  return out.sort((a, b) => a.time - b.time);
}

/** Scans in [from, to] (UTC ms), listing each UTC day the window touches. */
export async function listRange(station: string, from: number, to: number, fetchImpl: typeof fetch = fetch): Promise<ScanRef[]> {
  const days: Date[] = [];
  for (let d = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate()); d <= to; d += 86_400_000) {
    days.push(new Date(d));
  }
  const lists = await Promise.all(days.map((d) => listDay(station, d, fetchImpl)));
  return lists.flat().filter((s) => s.time >= from && s.time <= to);
}
