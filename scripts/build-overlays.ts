// Fetch the curated storms' overlays once and commit them as static GeoJSON (run: npm run build:overlays).
//   warnings.geojson: NWS tornado warning polygons as issued, from the Iowa Environmental
//                     Mesonet's VTEC archive (valid from issuance to expiry).
//   tracks.geojson:   surveyed tornado paths. NWS Damage Assessment Toolkit centerlines where they
//                     exist; otherwise the start→end segment from SPC's tornado database.
// All of it is public-domain NWS/SPC data; IEM is credited in the about panel.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORMS, type StormManifest } from '../src/data/storms';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const DAT = 'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer/1/query';

type Geometry = { type: string; coordinates: unknown };
type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: Geometry };
const collection = (features: Feature[]) => ({ type: 'FeatureCollection', features });

interface TrackSource {
  wfo: string;
  /** DAT query: surveyed paths on this local storm date. */
  dat?: { date: string; where?: string; times?: { start: string; end: string } };
  /** SPC fallback: a straight start→end segment. */
  spc?: { name: string; ef: string; start: [number, number]; end: [number, number]; startTime: string; endTime: string; lengthMi: number; widthYd: number; fatalities: number };
}

// Survey facts not carried by the geometry. Moore's DAT centerline has no reliable times, so the
// official times come from SPC (13:56-14:35 CST = 19:56-20:35 UTC). Joplin predates the DAT.
const SOURCES: Record<string, TrackSource> = {
  'moore-2013': {
    wfo: 'OUN',
    dat: { date: '2013-05-20', where: "efscale = 'N/A'", times: { start: '2013-05-20T19:56:00Z', end: '2013-05-20T20:35:00Z' } },
  },
  'joplin-2011': {
    wfo: 'SGF',
    spc: {
      name: 'Joplin tornado',
      ef: 'EF5',
      start: [-94.5932, 37.0524],
      end: [-94.2213, 36.9838],
      startTime: '2011-05-22T22:34:00Z',
      endTime: '2011-05-22T23:12:00Z',
      lengthMi: 21.62,
      widthYd: 1600,
      fatalities: 158,
    },
  },
  'pittsburgh-2026': { wfo: 'PBZ', dat: { date: '2026-06-06' } },
};

// DAT entries without an event name, labelled from the matching NWS local storm reports.
const UNNAMED: Record<string, string> = {
  '1780771080000': 'Beallsville Tornado',
  '1780771440000': 'Centerville Tornado',
};

const TRACK_FACTS: Record<string, Record<string, unknown>> = {
  'moore-2013': { name: 'Moore tornado', ef: 'EF5', lengthMi: 13.85, widthYd: 1900, fatalities: 24 },
};

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

async function warnings(wfo: string, start: string, end: string): Promise<Feature[]> {
  const url = `https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?begints=${start}&endts=${end}&wfo=${wfo}`;
  const data = await json<{ features: Feature[] }>(url);
  return data.features
    .filter((f) => f.properties.ph_sig === 'TO.W')
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        label: 'Tornado Warning',
        event: f.properties.eventid,
        status: f.properties.status,
        issued: f.properties.utc_issue,
        // Shown from issuance until expiry. (IEM's polygon_end marks the next follow-up statement,
        // which this endpoint doesn't return, so it would make warnings vanish early.)
        begin: Date.parse(String(f.properties.utc_issue)),
        end: Date.parse(String(f.properties.utc_expire)),
        counties: f.properties.locations,
      },
    }));
}

async function tracks(id: string, src: TrackSource, windowStart: number, windowEnd: number): Promise<Feature[]> {
  if (src.spc) {
    const s = src.spc;
    return [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [s.start, s.end] },
        properties: {
          name: s.name,
          ef: s.ef,
          start: Date.parse(s.startTime),
          end: Date.parse(s.endTime),
          lengthMi: s.lengthMi,
          widthYd: s.widthYd,
          fatalities: s.fatalities,
          source: 'SPC tornado database (straight start-to-end segment)',
        },
      },
    ];
  }
  const d = src.dat!;
  const next = new Date(Date.parse(d.date) + 86_400_000).toISOString().slice(0, 10);
  const where = `wfo='${src.wfo}' AND stormdate >= DATE '${d.date}' AND stormdate < DATE '${next}'${d.where ? ` AND ${d.where}` : ''}`;
  const params = new URLSearchParams({ where, outFields: 'event_id,starttime,endtime,efscale,length,width,fatalities', f: 'geojson' });
  const data = await json<{ features: Feature[] }>(`${DAT}?${params}`);
  return data.features
    .map((f): Feature => {
      const p = f.properties;
      const facts = TRACK_FACTS[id] ?? {};
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: (p.event_id as string) || UNNAMED[String(p.starttime)] || 'Tornado',
          ef: p.efscale,
          start: d.times ? Date.parse(d.times.start) : (p.starttime as number),
          end: d.times ? Date.parse(d.times.end) : (p.endtime as number),
          lengthMi: Math.round((p.length as number) * 100) / 100,
          widthYd: p.width,
          fatalities: p.fatalities,
          ...facts,
          source: 'NWS Damage Assessment Toolkit',
        },
      };
    })
    .filter((f) => (f.properties.end as number) >= windowStart && (f.properties.start as number) <= windowEnd);
}

for (const storm of STORMS) {
  const src = SOURCES[storm.id];
  if (!src) continue;
  const dir = join(ROOT, 'public', 'storms', storm.id);
  mkdirSync(dir, { recursive: true });
  const start = Date.parse(storm.start);
  const end = Date.parse(storm.end);
  const w = await warnings(src.wfo, storm.start.slice(0, 16) + 'Z', storm.end.slice(0, 16) + 'Z');
  const t = await tracks(storm.id, src, start, end);
  writeFileSync(join(dir, 'warnings.geojson'), JSON.stringify(collection(w)));
  writeFileSync(join(dir, 'tracks.geojson'), JSON.stringify(collection(t)));
  const manifestPath = join(dir, 'manifest.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StormManifest;
    manifest.overlays = { warnings: 'warnings.geojson', track: 'tracks.geojson' };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  } catch {
    console.warn(`  (no manifest yet for ${storm.id}; run build:storms first)`);
  }
  console.log(`${storm.id}: ${w.length} warning polygons, ${t.length} tracks (${t.map((f) => f.properties.name).join(', ')})`);
}
