import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre locates its tile worker next to its own module, which breaks once Vite bundles it.
// Bundle the worker explicitly and point MapLibre at it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './style.css';
import { RadarClient } from './radarClient';
import { legendStops } from './render/colormaps';
import { RadarLayer } from './render/radarLayer';
import type { FetchStats, Frame, Product } from './types';

const BUCKET = 'https://unidata-nexrad-level2.s3.amazonaws.com';
// Milestone 1: one hard-coded scan, Moore EF5 just before touchdown.
const SCAN_KEY = '2013/05/20/KTLX/KTLX20130520_195527_V06.gz';
const KTLX: [number, number] = [-97.2775, 35.3331];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const status = $('#status');
const meta = $('#meta');
const stats = $('#stats');
const legend = $('#legend');

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [-97.45, 35.25],
  zoom: 8,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const radar = new RadarLayer();
const client = new RadarClient();
const product: Product = 'REF';

function firstSymbolLayer(): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

function fmtTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(ms);
}

function renderLegend(p: Product): void {
  const stops = legendStops(p);
  legend.innerHTML = `<span class="legend-title">${p === 'REF' ? 'Reflectivity (dBZ)' : 'Velocity (m/s)'}</span>
    <div class="legend-bar">${stops.map((s) => `<span style="background:${s.css}" title="${s.value}"></span>`).join('')}</div>
    <div class="legend-labels"><span>${stops[0]!.value}</span><span>${stops[stops.length - 1]!.value}+</span></div>`;
}

function showFrame(frame: Frame, s: FetchStats, firstFrameMs: number): void {
  radar.show(frame, product);
  const m = frame.ref;
  meta.innerHTML = `<strong>${frame.station}</strong> · VCP ${frame.vcp} · ${m.elevationDeg.toFixed(1)}° tilt<br>
    ${fmtTime(frame.time, 'UTC')}<br>${fmtTime(frame.time, 'America/Chicago')}`;
  const mb = (n: number) => (n / 1e6).toFixed(1);
  stats.textContent =
    `${mb(s.bytesDownloaded)} MB of ${s.fileBytes ? mb(s.fileBytes) : '?'} MB downloaded · ` +
    `decode ${s.decodeMs.toFixed(0)} ms · scan ready in ${s.totalMs.toFixed(0)} ms · first frame ${firstFrameMs.toFixed(0)} ms`;
  console.info('[storm-replay] frame', { station: frame.station, time: new Date(frame.time).toISOString(), ...s, firstFrameMs });
}

const tStart = performance.now();
renderLegend(product);
const scanPromise = client.load(`${BUCKET}/${SCAN_KEY}`);

map.on('load', async () => {
  map.addLayer(radar, firstSymbolLayer());
  new maplibregl.Marker({ color: '#e8eef7', scale: 0.6 }).setLngLat(KTLX).addTo(map);
  try {
    const { frame, stats: s } = await scanPromise;
    status.hidden = true;
    map.once('render', () => showFrame(frame, s, performance.now() - tStart));
    radar.show(frame, product);
  } catch (err) {
    status.textContent = `Could not load the scan: ${(err as Error).message}`;
    status.classList.add('error');
  }
});

// Dev-only handle for poking at the map from the console / browser automation.
if (import.meta.env.DEV) Object.assign(window, { stormReplay: { map, radar } });
