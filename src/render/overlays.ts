// Vector overlays drawn by MapLibre itself: tornado warning polygons valid at the scan time, the
// surveyed damage path (dashed in full, solid up to the scan time), and rotation markers.
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Rotation } from '../types';

type Position = [number, number];
interface Feature<P = Record<string, unknown>> {
  type: 'Feature';
  properties: P;
  geometry: { type: string; coordinates: unknown };
}
interface FC<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}
interface WarningProps {
  begin: number;
  end: number;
}
interface TrackProps {
  name: string;
  ef: string;
  start: number;
  end: number;
}

export interface MarkedRotation extends Rotation {
  /** A detection within ~10 km existed in the previous scan too. */
  persistent: boolean;
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const empty = <P>(): FC<P> => ({ type: 'FeatureCollection', features: [] });

/** Metres along a lon/lat polyline (equirectangular; fine at storm scale). */
function lengths(coords: Position[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1]!;
    const [x1, y1] = coords[i]!;
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    out.push(out[i - 1]! + Math.hypot((x1 - x0) * k, y1 - y0) * 111_320);
  }
  return out;
}

/** The part of a line from its start to fraction f of its length. */
export function slice(coords: Position[], f: number): Position[] {
  if (f <= 0 || coords.length < 2) return [];
  if (f >= 1) return coords;
  const len = lengths(coords);
  const target = len[len.length - 1]! * f;
  const out: Position[] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    if (len[i]! < target) {
      out.push(coords[i]!);
      continue;
    }
    const t = (target - len[i - 1]!) / (len[i]! - len[i - 1]! || 1);
    const [x0, y0] = coords[i - 1]!;
    const [x1, y1] = coords[i]!;
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    break;
  }
  return out;
}

export class Overlays {
  private warnings = empty<WarningProps>();
  private tracks = empty<TrackProps>();
  visible = { warnings: true, tracks: true, rotation: true };

  constructor(private readonly map: MapLibreMap) {}

  /** Add sources + layers. Call after the style loads; `beforeId` keeps labels on top. */
  install(beforeId?: string): void {
    const m = this.map;
    for (const id of ['warnings', 'tracks', 'track-progress', 'rotation']) m.addSource(id, { type: 'geojson', data: EMPTY as never });
    m.addLayer({ id: 'warnings-fill', type: 'fill', source: 'warnings', paint: { 'fill-color': '#ff1f1f', 'fill-opacity': 0.08 } }, beforeId);
    m.addLayer({ id: 'warnings-line', type: 'line', source: 'warnings', paint: { 'line-color': '#ff3b3b', 'line-width': 2 } }, beforeId);
    m.addLayer(
      { id: 'tracks-line', type: 'line', source: 'tracks', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [2, 2] } },
      beforeId,
    );
    m.addLayer(
      { id: 'track-progress-line', type: 'line', source: 'track-progress', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 4 } },
      beforeId,
    );
    m.addLayer({
      id: 'rotation-ring',
      type: 'circle',
      source: 'rotation',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'strength'], 'strong'], 13, 10],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': ['case', ['get', 'persistent'], 3, 2],
        'circle-stroke-color': ['case', ['==', ['get', 'strength'], 'strong'], '#ff4dff', '#ffe14d'],
        'circle-stroke-opacity': ['case', ['get', 'persistent'], 1, 0.6],
      },
    });
    m.addLayer({
      id: 'rotation-label',
      type: 'symbol',
      source: 'rotation',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-offset': [0, 1.8],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 },
    });
  }

  async load(warningsUrl: string | null, tracksUrl: string | null): Promise<void> {
    const get = async <T>(url: string | null): Promise<FC<T>> => (url ? ((await (await fetch(url)).json()) as FC<T>) : empty<T>());
    [this.warnings, this.tracks] = await Promise.all([get<WarningProps>(warningsUrl), get<TrackProps>(tracksUrl)]);
    this.src('tracks').setData((this.visible.tracks ? this.tracks : EMPTY) as never);
  }

  clear(): void {
    this.warnings = empty<WarningProps>();
    this.tracks = empty<TrackProps>();
    for (const id of ['warnings', 'tracks', 'track-progress', 'rotation']) this.src(id).setData(EMPTY as never);
  }

  private src(id: string): GeoJSONSource {
    return this.map.getSource(id) as GeoJSONSource;
  }

  /** Tornadoes on the ground (per survey) at time t, for the caption line. */
  activeTracks(t: number): TrackProps[] {
    return this.tracks.features.map((f) => f.properties).filter((p) => p.start <= t && t <= p.end);
  }

  update(t: number, rotations: MarkedRotation[]): void {
    const active = this.warnings.features.filter((f) => f.properties.begin <= t && t < f.properties.end);
    this.src('warnings').setData((this.visible.warnings ? { type: 'FeatureCollection', features: active } : EMPTY) as never);

    const progress = this.tracks.features
      .map((f) => {
        const p = f.properties;
        const coords = f.geometry.coordinates as Position[];
        const done = slice(coords, (t - p.start) / Math.max(1, p.end - p.start));
        return done.length >= 2 ? { type: 'Feature', properties: p, geometry: { type: 'LineString', coordinates: done } } : null;
      })
      .filter(Boolean);
    this.src('tracks').setData((this.visible.tracks ? this.tracks : EMPTY) as never);
    this.src('track-progress').setData((this.visible.tracks ? { type: 'FeatureCollection', features: progress } : EMPTY) as never);

    const pts = rotations.map((r) => ({
      type: 'Feature',
      properties: { strength: r.strength, persistent: r.persistent, label: `${Math.round(r.vrotMs * 1.944)} kt` },
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    }));
    this.src('rotation').setData((this.visible.rotation ? { type: 'FeatureCollection', features: pts } : EMPTY) as never);
  }
}

/** Flag detections that also appeared (within maxKm) in the previous scan: real vortices persist. */
export function associate(current: Rotation[], previous: Rotation[] | null, maxKm = 10): MarkedRotation[] {
  return current.map((r) => ({
    ...r,
    persistent:
      !!previous &&
      previous.some((p) => Math.hypot((p.lat - r.lat) * 111.32, (p.lon - r.lon) * 111.32 * Math.cos((r.lat * Math.PI) / 180)) <= maxKm),
  }));
}
