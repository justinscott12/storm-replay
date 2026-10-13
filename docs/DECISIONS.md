# Decisions

Short entries: what we decided, why, and what we rejected. Newest at the bottom.

## 2026-10-13 · Repo name `storm-replay`, prototype kept in `prototype/`

The site will live at `https://justinscott12.github.io/storm-replay/`. The Python/Py-ART scrubber
moved to `prototype/` and stays as the correctness oracle. Rejected: `nexrad-replay` (jargon in the
URL), a fresh folder (it would split the history from the prototype).

## 2026-10-13 · Custom Archive II decoder instead of `nexrad-level-2-data`

Spike result: `nexrad-level-2-data@3.0.2` parses our files in Node (~550 ms for a whole KTLX
volume), but it won't run in a Vite worker as shipped. It imports `node:zlib`, loads its bzip2 wasm
via a webpack-only `require("./module.wasm")`, and always decodes all ~17 tilts with no way to stop
early. Shimming all three would mean forking it.

We wrote a focused decoder instead (`src/decoder/`, ~450 lines with bzip2): volume header → LDM
bzip2 records *or* bare message stream → Message 31 → REF/VEL moments. It's incremental: it takes
bytes as they arrive and reports when it has the lowest REF and VEL sweeps, so the download stops
there. Tests compare 40 random gates per sweep, the valid-gate counts, radial counts, gate geometry,
site location and VCP against Py-ART on two real files (one per storage format), and all match exactly.

Rejected: `seek-bzip` (uses Node `Buffer`), `@foxglove/wasm-bz2` directly (1 MB wasm plus the same
loader problem). A wasm bzip2 is still an option if raw-file decode time matters (see numbers below).

## 2026-10-13 · Two on-bucket formats, one decoder path

Found during the spike: Unidata's older `.gz` keys (e.g. 2013 KTLX) are gzip around an
**uncompressed** message stream, with no bzip2 inside. Newer raw keys (e.g. 2026 KPBZ) are LDM records,
each a bzip2 stream. The decoder sniffs the 4 bytes after the volume header for `BZh` and handles both.
Gzip is undone by the browser's native `DecompressionStream`.

## 2026-10-13 · Stream and cancel instead of HTTP Range guesses

The bucket's CORS allows `Range`, but you can't range into the middle of a gzip stream, and how many
bytes the lowest tilt needs varies by VCP and format. So the worker streams the object, decompresses
on the fly, and cancels the fetch as soon as the decoder has both sweeps. Measured in Chrome on
KTLX 19:55: **1.5 MB of 8.3 MB downloaded** (decoder needs ~1.2 MB; the rest is stream buffering),
11 ms of decode CPU, scan ready 257 ms after the request.

Node measurements of decode CPU alone: KTLX `.gz` path 7 ms after a 71 ms full gunzip. KPBZ raw
bzip2 path: ~256 ms for the first two tilts (~2.5 MB of 7.1 MB). This is the biggest per-frame cost
for modern data, so it's the first thing to optimise if playback is CPU-bound.

## 2026-10-13 · Render: one quad + polar texture in a MapLibre custom layer

Each frame is a `R8UI` texture (720 azimuth rows at 0.5° × N gates) of raw codes, plus a 256-entry
RGBA lookup texture (code → colour). The layer draws one quad covering the radar's range. The fragment
shader converts each pixel's mercator position to lat/lon, then to ground range and azimuth from the
site, and does a `texelFetch`. So no per-gate geometry (~1.3 M gates), a new frame is one texture
upload, and the reflectivity/velocity toggle is just a LUT swap. Ground range stands in for slant range
(< 0.1% error at the 0.5° tilt). Radials are resampled into fixed 0.5° bins in the worker
(`toAzimuthGrid`), so 1° legacy-resolution sweeps work too.

Rejected: deck.gl (a large dependency for one layer), per-gate triangles (millions of vertices),
rendering to a canvas image source (CPU-bound, and blurry when you zoom in).

## 2026-10-13 · MapLibre GL + OpenFreeMap `dark` style

OpenFreeMap is free with no keys, no limits and no cookies; attribution is required, and MapLibre adds
it automatically (verified on openfreemap.org, 2026-10-13). The dark basemap makes radar colours
readable. MapLibre's worker has to be bundled explicitly (`?worker&url` + `setWorkerUrl`) because
Vite's bundling breaks its self-location. Cost: about 290 KB gzipped of JS, almost all MapLibre.

## 2026-10-13 · Vite 6 / Vitest 3 / TypeScript 5.9 (not the latest majors)

The dev machine runs Node 20.9. Vite 8, Vitest 5 and TypeScript 7 need Node ≥ 20.19 or 22, and TS 7's
`tsc` didn't run at all. The older majors are current, supported releases. CI can use Node 22; bump
everything together once the local Node is upgraded.

## 2026-10-13 · Reflectivity palette: NWS RIDGE steps, transparent below 5 dBZ

These are the classic 5-dBZ steps from the NWS RIDGE palette. Clear-air returns below 5 dBZ are
hidden so the map stays readable. Py-ART's continuous −10..70 scale shows them; that's a styling
difference, not a decoding one (the oracle test checks values, not colours).

## 2026-10-13 · Playback: worker pool, prefetch 6, LRU of 40, wait instead of skip

`RadarClient` runs up to three decode workers (hardware threads − 1) and sends each request to the
least busy one, so one slow frame doesn't hold up the next. `Player` keeps the 6 frames after the
playhead loading, and caches decoded frames (as promises, so concurrent requests share one load) in an
LRU of 40, about 100 MB at worst for full-range raw frames. During playback the loop **waits** for the
next frame rather than skipping it, because a radar loop with gaps hides exactly what you're watching.
The play button pulses while it waits. A frame that fails to load is stepped over.

## 2026-10-13 · Curated storms are preprocessed (data path 1), and both paths stay

Measured: a raw-path frame needs 1.5 MB (KTLX 2013 `.gz`) to 2.5 MB (KPBZ 2026 bzip2) downloaded,
plus ~250 ms of bzip2 CPU for modern data. A preprocessed frame is the decoder's own output (the
azimuth-binned uint8 grids plus JSON metadata, format `SRF1` in `src/data/packed.ts`), cropped to
300 km, with reflectivity below the 5 dBZ display threshold zeroed, then gzipped: **222 KB (Moore),
264 KB (Joplin), 292 KB (Pittsburgh) per frame**, about 6× smaller than the raw path. It needs no
bzip2 and decodes in a few ms. All three storms total 11 MB in the repo (`public/storms/`).

The raw path is kept for share links outside the featured storms (and for explore mode, M4). The
build script (`npm run build:storms`) uses the same decoder as the browser, so both paths draw from
identical data.

Rejected: delta-coding rows or gates before gzip (±5%, not worth the complexity), brotli (−15%, but
`DecompressionStream` can't decode it in all browsers), and range-requesting raw volumes for the
featured storms (still ~5× more bytes).

## 2026-10-13 · Pittsburgh window is 18:15–19:20 UTC, not ~03:05

The brief said the KPBZ storm was "from ~03:05 UTC". The 03:05 scan is clear air (VCP 35, max 28 dBZ).
The NWS storm survey (DAT + local storm reports) puts six EF1 tornadoes in Washington, Fayette and
Westmoreland counties at **18:38–19:00 UTC** (2:38–3:00 pm EDT), with a tornado warning at 18:44.
The storyboard uses that window.

## 2026-10-13 · Shareable links are `#STATION/YYYY-MM-DDTHH:MMZ/ref|vel`

A link into a featured storm's window opens that storm (fast path) at the nearest scan. Any other
station or time lists ±45 minutes around it from the bucket and streams raw volumes, which is a small
preview of explore mode. The hash updates (`replaceState`) as you scrub or play, so the URL bar is
always a link to what's on screen.

## 2026-10-13 · Overlays: IEM warnings, DAT/SPC damage paths, fetched at build time

- **Tornado warnings:** NWS polygons from the Iowa Environmental Mesonet's VTEC archive
  (`/api/1/vtec/sbw_interval.geojson`), shown from issuance to expiry. IEM's `polygon_end` marks the
  next follow-up statement, which this endpoint doesn't return, so using it made warnings vanish early.
- **Damage paths:** NWS Damage Assessment Toolkit centerlines (Moore's re-analyzed 354-point centerline,
  and Pittsburgh's six EF1s). Joplin predates the DAT, so it uses SPC's start→end segment, which is
  straight. The real path curved, so Joplin's radar couplet runs ~4 km north of that line. Moore's DAT
  record has no usable times, so its official 19:56–20:35 UTC comes from SPC.
- The path is dashed in full and drawn solid up to the current scan time, interpolated along its length.

All of it is fetched once by `npm run build:overlays` and committed. The site makes no calls to these
services, so their uptime can't break it.

## 2026-10-13 · Rotation detection: azimuthal shear on dealiased base velocity

`src/analysis/rotation.ts`, which runs in the worker on every frame (~100 ms):
1. **Dealias.** Unfold each radial outward from the radar using continuity (reference = mean of the last
   4 unfolded gates, seeded from the neighbouring radial after a gap), then fold remaining outliers
   toward their 5×5 median. Only gates far from their neighbourhood mean get the sort, which made it 3×
   faster. Moore's couplet exceeds the 26 m/s Nyquist speed, so without this it's invisible.
2. **Shear.** Along each range ring (10–150 km), look at an arc of ≤ 2.5 km for the strongest inbound
   and outbound values, with inbound anticlockwise of outbound (cyclonic). Vrot = (out − in)/2.
3. **Filter.** ≥ 20 dBZ at the spot, each peak backed by ≥ 3 of its 4 neighbours (kills speckle), ≥ 4
   supporting candidates within 3 km, and a shear zone ≤ 6 km long in range. Long radial shear lines
   are dealiasing seams, not vortices. Non-max suppression at 5 km.
4. **Time association (UI).** A detection near one in the previous scan (≤ 10 km) is drawn bold, like
   the time-association step in the NWS mesocyclone algorithm.

Validation (tests in `test/app.test.ts`): at Moore's 19:55 scan, the top detection is within 2 km of
SPC's surveyed touchdown point (35.284, −97.628). It then follows the surveyed path east through Moore
until 20:29 (Vrot peaks at 61 m/s, ~119 kt, at 20:16), with no detections before the storm organises.
Joplin's couplet is found at 22:43–22:53 and 23:07. Remaining false alarms are mostly near-radar clutter
and distant storms. **Limitation:** Pittsburgh's EF1s were brief, line-embedded spin-ups with Vrot
below 20 m/s, and they aren't flagged. Lowering the threshold to catch them floods Moore and Joplin
with false alarms. The caption says this rather than hiding it.

Rejected: Py-ART's region-based dealiasing (needs a Python backend), and a learned detector (out of
scope).

## 2026-10-13 · `vite preview` must use the Pages base path too

`defineConfig(({ command }))` reports `serve` for `vite preview`, so the preview served the build at `/`
while the HTML asked for `/storm-replay/assets/…` (404). The base now applies to `build` and `isPreview`.
The `storm-replay-build` launch entry previews the real sub-path.
