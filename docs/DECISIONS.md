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
