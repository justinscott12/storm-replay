# Progress

Storm Replay: replay real NEXRAD radar in the browser, as a static site on GitHub Pages
(`justinscott12.github.io/storm-replay/`). The full brief is in [BUILD_PROMPT.md](BUILD_PROMPT.md),
and the design decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Resume in five minutes

```bash
npm install
npm run fixtures   # downloads the 2 real radar files the tests use (15 MB, gitignored)
npm test           # decoder vs Py-ART oracle
npm run dev        # http://localhost:5173
```

Claude preview: the `storm-replay` entry in `workspace/.claude/launch.json` (and `.claude/launch.json` here).

## Status

| Milestone | State |
| --- | --- |
| 1. One scan on a map | **Done 2026-10-13** |
| 2. Velocity + playback | Next |
| 3. Curated replays | |
| 4. Explore mode | |
| 5. Polish + launch kit | |

### Milestone 1: done (2026-10-13)

- Vite + strict TS scaffold, MapLibre on OpenFreeMap `dark`, production build under `/storm-replay/`.
- `src/decoder/`: incremental Archive II decoder (both `.gz` and bzip2-LDM formats), own bzip2,
  Message 31 REF/VEL, legacy Message 1 → `UnsupportedFormatError`.
- `src/worker.ts`: streams the scan, gunzips natively, cancels the download once the lowest tilt is
  decoded, and transfers ready-to-upload grids to the UI.
- `src/render/radarLayer.ts`: WebGL custom layer (polar texture + colour LUT) using NWS reflectivity colours.
- Verified: 8 unit tests; decoded values equal Py-ART on KTLX 2013-05-20 19:55 and KPBZ
  2026-06-06 03:05. Side-by-side with the Py-ART render at ±80 km:
  [docs/img/m1-oracle-compare.png](docs/img/m1-oracle-compare.png). The hook is W of Newcastle, SW of
  KTLX and S of OKC: [docs/img/m1-moore-hook-z10.png](docs/img/m1-moore-hook-z10.png).
- Measured (Chrome, KTLX 19:55): 1.5 MB of 8.3 MB downloaded, 11 ms decode, scan ready 257 ms after the request.

## Next: milestone 2 (velocity + playback)

**First concrete step:** add a REF/VEL toggle. The worker already returns `frame.vel`, and
`RadarLayer.show(frame, 'VEL')` already swaps the LUT, so it's a button plus `renderLegend('VEL')`.
After that: list the KTLX 19:30–20:45 keys from the bucket (18 scans, ~4.3 min apart), add a timeline
with play/pause/speed/scrub, and prefetch N ahead into an LRU of decoded frames.

## Known issues

- "First frame" in the stats line is wrong inside the hidden Claude preview pane (~7 s): the basemap
  doesn't paint until the pane is visible. Re-measure in a visible browser in M3 / M5.
- KPBZ-style raw files take ~250 ms of bzip2 CPU per frame (Node). Fine for one frame; watch it during
  playback, and consider a wasm bzip2 or a wider prefetch window.
- OpenFreeMap's style asks for a glyph range it doesn't serve (Osage script, U+104B0). It's a harmless
  console warning from the basemap, not our code.
- Local time is hard-coded to America/Chicago for KTLX; a station → time zone table comes with the
  station list in M4.

## Later (ideas, not in scope yet)

- Smooth gate edges with a 1-texel bilinear option when zoomed far in.
- Show a range-ring / distance overlay and a click-to-read value tooltip (dBZ or m/s at the cursor).
- Shareable URLs (`#KTLX/2013-05-20T19:55Z/vel`).
