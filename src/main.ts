import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre locates its tile worker next to its own module, which breaks once Vite bundles it.
// Bundle the worker explicitly and point MapLibre at it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './style.css';
import { formatHash, parseHash, type Route } from './app/route';
import { listRange } from './data/bucket';
import { STORMS, stormById, type StormDef, type StormManifest } from './data/storms';
import { Player, type FrameRef, type FrameStatus } from './player/player';
import { RadarClient, type Loaded } from './radarClient';
import { legendStops } from './render/colormaps';
import { associate, Overlays } from './render/overlays';
import { RadarLayer } from './render/radarLayer';
import type { Product } from './types';

const T0 = performance.now();
const BASE = import.meta.env.BASE_URL;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const ui = {
  storms: $('#storms'),
  title: $('#storm-title'),
  subtitle: $('#storm-subtitle'),
  caption: $('#caption'),
  legend: $('#legend'),
  meta: $('#meta'),
  rotation: $('#rotation-info'),
  status: $('#status'),
  stats: $('#stats'),
  play: $<HTMLButtonElement>('#play'),
  scrub: $<HTMLInputElement>('#scrub'),
  buffer: $('#buffer'),
  timeUtc: $('#time-utc'),
  timeLocal: $('#time-local'),
  speed: $<HTMLSelectElement>('#speed'),
  share: $<HTMLButtonElement>('#share'),
  about: $<HTMLDialogElement>('#about'),
};

maplibregl.setWorkerUrl(maplibreWorkerUrl);
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: STORMS[0]!.center,
  zoom: STORMS[0]!.zoom,
  attributionControl: { compact: true },
  fadeDuration: reducedMotion ? 0 : 300,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const radar = new RadarLayer();
const overlays = new Overlays(map);
const client = new RadarClient();
const player = new Player(client);

const state = {
  product: 'REF' as Product,
  storm: null as StormDef | null,
  station: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  current: null as Loaded | null,
  firstFrameMs: null as number | null,
  siteMarker: null as maplibregl.Marker | null,
};

// ---------- formatting ----------

const fmt = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms);
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function renderLegend(): void {
  const stops = legendStops(state.product);
  const vel = state.product === 'VEL';
  ui.legend.innerHTML = `<span class="legend-title">${vel ? 'Velocity (m/s): green toward radar, red away' : 'Reflectivity (dBZ)'}</span>
    <div class="legend-bar">${stops.map((s) => `<span style="background:${s.css}" title="${s.value}"></span>`).join('')}</div>
    <div class="legend-labels"><span>${vel ? '≤ ' : ''}${stops[0]!.value}</span>${vel ? '<span>0</span>' : ''}<span>${stops[stops.length - 1]!.value}+</span></div>`;
}

function renderStormButtons(): void {
  ui.storms.innerHTML = STORMS.map(
    (s) => `<button type="button" data-storm="${s.id}" aria-pressed="${state.storm?.id === s.id}">${s.title.split(',')[0]}</button>`,
  ).join('');
}

function renderBuffer(): void {
  const n = player.frames.length;
  ui.buffer.innerHTML = player.frames.map((_, i) => `<span class="b-${player.status(i)}" style="width:${100 / n}%"></span>`).join('');
}

function setStatus(text: string, error = false): void {
  ui.status.textContent = text;
  ui.status.classList.toggle('error', error);
}

// ---------- showing a frame ----------

async function showFrame(index: number, loaded: Loaded): Promise<void> {
  state.current = loaded;
  const { frame, stats } = loaded;
  radar.show(frame, state.product === 'VEL' && !frame.vel ? 'REF' : state.product);

  ui.scrub.value = String(index);
  ui.scrub.setAttribute('aria-valuetext', utc(frame.time));
  ui.timeUtc.textContent = utc(frame.time);
  ui.timeLocal.textContent = fmt(frame.time, state.timeZone);

  const m = state.product === 'VEL' && frame.vel ? frame.vel : frame.ref;
  ui.meta.textContent = `${frame.station} · VCP ${frame.vcp} · ${m.elevationDeg.toFixed(1)}° tilt · scan ${index + 1} of ${player.frames.length}`;

  // Caption: the storm's latest beat, plus which surveyed tornadoes are on the ground.
  if (state.storm) {
    const beat = [...state.storm.beats].reverse().find((b) => Date.parse(b.at) <= frame.time);
    ui.caption.textContent = beat?.text ?? '';
  }
  const onGround = overlays.activeTracks(frame.time);
  const prev = index > 0 ? await player.cached(index - 1) : null;
  const rotations = associate(frame.rotations, prev?.frame.rotations ?? null);
  overlays.update(frame.time, rotations);
  const strongest = rotations[0];
  ui.rotation.innerHTML =
    (onGround.length ? `<span class="tag tag-tor">Tornado on the ground</span> ${onGround.map((t) => `${t.name} (${t.ef})`).join(', ')}<br>` : '') +
    (strongest && overlays.visible.rotation
      ? `<span class="tag tag-rot">Rotation</span> ${Math.round(strongest.vrotMs * 1.944)} kt, ${strongest.rangeKm.toFixed(0)} km from radar${strongest.persistent ? ', also in previous scan' : ''}`
      : '');

  const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
  ui.stats.textContent =
    `${stats.kind === 'packed' ? 'Preprocessed frame' : 'Raw Archive II'} · ${kb(stats.bytesDownloaded)}` +
    `${stats.kind === 'archive' && stats.fileBytes ? ` of ${kb(stats.fileBytes)}` : ''} · decode ${stats.decodeMs.toFixed(0)} ms · rotation ${stats.rotationMs?.toFixed(0) ?? '?'} ms` +
    (state.firstFrameMs ? ` · first frame ${(state.firstFrameMs / 1000).toFixed(2)} s` : '');

  history.replaceState(null, '', formatHash({ station: frame.station, time: frame.time, product: state.product }));

  if (state.firstFrameMs === null) {
    state.firstFrameMs = 0;
    map.once('render', () => {
      state.firstFrameMs = performance.now() - T0;
      console.info(`[storm-replay] first frame painted at ${state.firstFrameMs.toFixed(0)} ms`, stats);
    });
  }
}

// ---------- loading storms / scans ----------

async function loadStorm(storm: StormDef, at?: number, product?: Product): Promise<void> {
  state.storm = storm;
  state.station = storm.station;
  state.timeZone = storm.timeZone;
  setProduct(product ?? storm.product, false);
  renderStormButtons();
  ui.title.textContent = storm.title;
  ui.subtitle.textContent = storm.subtitle;
  setStatus('Loading storm…');
  try {
    const dir = `${BASE}storms/${storm.id}/`;
    const manifest = (await (await fetch(`${dir}manifest.json`)).json()) as StormManifest;
    const frames: FrameRef[] = manifest.frames.map((f) => ({ time: f.time, kind: 'packed', url: dir + f.file }));
    await overlays.load(manifest.overlays.warnings && dir + manifest.overlays.warnings, manifest.overlays.track && dir + manifest.overlays.track);
    map.jumpTo({ center: storm.center, zoom: storm.zoom });
    setScrubRange(frames.length);
    await player.setFrames(frames, nearest(frames, at ?? Date.parse(storm.focus)));
    setStatus('');
  } catch (err) {
    setStatus(`Couldn't load ${storm.title}: ${(err as Error).message}`, true);
  }
}

/** Any station/time: list ±45 minutes around it from the bucket and stream raw volumes. */
async function loadStation(route: Route): Promise<void> {
  state.storm = null;
  state.station = route.station;
  state.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  setProduct(route.product, false);
  renderStormButtons();
  ui.title.textContent = `${route.station} radar`;
  ui.subtitle.textContent = new Date(route.time).toUTCString().slice(0, 16);
  ui.caption.textContent = 'Streaming raw volumes from the NOAA archive and decoding them in your browser.';
  overlays.clear();
  setStatus(`Listing ${route.station} scans…`);
  try {
    const scans = await listRange(route.station, route.time - 45 * 60_000, route.time + 45 * 60_000);
    if (scans.length === 0) {
      setStatus(`No ${route.station} scans in the archive within 45 minutes of ${utc(route.time)}.`, true);
      return;
    }
    const frames: FrameRef[] = scans.map((s) => ({ time: s.time, kind: 'archive', url: s.url }));
    setScrubRange(frames.length);
    setStatus('Decoding…');
    await player.setFrames(frames, nearest(frames, route.time));
    const f = state.current?.frame;
    if (f) map.jumpTo({ center: [f.lon, f.lat], zoom: 7.5 });
    setStatus('');
  } catch (err) {
    setStatus(`Couldn't load ${route.station}: ${(err as Error).message}`, true);
  }
}

function nearest(frames: FrameRef[], t: number): number {
  let best = 0;
  frames.forEach((f, i) => {
    if (Math.abs(f.time - t) < Math.abs(frames[best]!.time - t)) best = i;
  });
  return best;
}

function setScrubRange(n: number): void {
  ui.scrub.max = String(Math.max(0, n - 1));
}

function placeSiteMarker(lon: number, lat: number): void {
  state.siteMarker?.remove();
  const el = document.createElement('div');
  el.className = 'site';
  el.title = `${state.station} radar`;
  state.siteMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
}

function setProduct(p: Product, rerender = true): void {
  state.product = p;
  document.querySelectorAll<HTMLButtonElement>('[data-product]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.product === p)));
  renderLegend();
  if (rerender && state.current) void showFrame(player.index, state.current);
}

async function openRoute(r: Route | null): Promise<void> {
  if (!r) return loadStorm(STORMS[0]!);
  const storm = STORMS.find((s) => s.station === r.station && r.time >= Date.parse(s.start) - 10 * 60_000 && r.time <= Date.parse(s.end) + 10 * 60_000);
  return storm ? loadStorm(storm, r.time, r.product) : loadStation(r);
}

// ---------- events ----------

player.on('frame', ({ index, loaded }) => {
  const { frame } = loaded;
  const site = state.siteMarker?.getLngLat();
  if (!site || site.lat !== frame.lat || site.lng !== frame.lon) placeSiteMarker(frame.lon, frame.lat);
  void showFrame(index, loaded);
});
player.on('state', ({ playing, buffering }) => {
  ui.play.textContent = playing ? '❚❚' : '▶';
  ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  ui.play.classList.toggle('buffering', buffering);
});
player.on('status', ({ index, status, error }: { index: number; status: FrameStatus; error?: Error }) => {
  renderBuffer();
  if (status === 'error' && index === Number(ui.scrub.value)) setStatus(`Scan unavailable: ${error?.message ?? 'unknown error'}`, true);
});

ui.play.addEventListener('click', () => player.toggle());
ui.scrub.addEventListener('input', () => {
  player.pause();
  void player.seek(Number(ui.scrub.value));
});
ui.speed.addEventListener('change', () => (player.fps = Number(ui.speed.value)));
ui.storms.addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-storm]')?.dataset.storm;
  const storm = id ? stormById(id) : undefined;
  if (storm) void loadStorm(storm).then(() => !reducedMotion && player.play());
});
document.querySelectorAll<HTMLButtonElement>('[data-product]').forEach((b) => b.addEventListener('click', () => setProduct(b.dataset.product as Product)));
for (const key of ['warnings', 'tracks', 'rotation'] as const) {
  $<HTMLInputElement>(`#t-${key}`).addEventListener('change', (e) => {
    overlays.visible[key] = (e.target as HTMLInputElement).checked;
    if (state.current) void showFrame(player.index, state.current);
  });
}
ui.share.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('Link copied.');
  } catch {
    setStatus(location.href);
  }
});
$('#about-btn').addEventListener('click', () => ui.about.showModal());
window.addEventListener('hashchange', () => {
  // replaceState (our own updates) doesn't fire hashchange, so this is a pasted or edited link.
  const r = parseHash(location.hash);
  const f = state.current?.frame;
  if (r && !(f && r.station === f.station && Math.abs(r.time - f.time) < 60_000)) void openRoute(r);
  else if (r && r.product !== state.product) setProduct(r.product);
});
window.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'SELECT' || ui.about.open) return;
  if (el.tagName === 'INPUT' && !['range', 'checkbox'].includes((el as HTMLInputElement).type)) return;
  const actions: Record<string, () => void> = {
    ' ': () => player.toggle(),
    ArrowRight: () => player.step(1),
    ArrowLeft: () => player.step(-1),
    Home: () => {
      player.pause();
      void player.seek(0);
    },
    End: () => {
      player.pause();
      void player.seek(player.frames.length - 1);
    },
    r: () => setProduct('REF'),
    v: () => setProduct('VEL'),
  };
  const fn = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!fn) return;
  e.preventDefault();
  fn();
});

renderLegend();
renderStormButtons();

map.on('load', () => {
  // Radar goes above land/water/buildings but under roads and boundaries (they help you get your
  // bearings); warnings, tracks and rotation go above roads but under the place labels.
  const layers = map.getStyle().layers;
  const roads = layers.find((l) => /^(tunnel|road|bridge|highway|boundary)/.test(l.id))?.id;
  const labels = layers.find((l, i) => l.type === 'symbol' && layers.slice(i).every((x) => x.type === 'symbol'))?.id;
  map.addLayer(radar, roads ?? labels);
  overlays.install(labels);
  void openRoute(parseHash(location.hash)).then(() => {
    // Open the link, watch it play. With reduced motion, wait for the user to press play.
    if (!reducedMotion && state.storm) setTimeout(() => player.play(), 600);
  });
});

// Dev-only handle for poking at the map from the console / browser automation.
if (import.meta.env.DEV) Object.assign(window, { stormReplay: { map, radar, player, state } });
