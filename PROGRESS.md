# Progress

Storm Replay: replay real NEXRAD radar in the browser, as a static site on GitHub Pages
(`justinscott12.github.io/storm-replay/`). The full brief is in [BUILD_PROMPT.md](BUILD_PROMPT.md),
and the design decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Resume in five minutes

```bash
npm install
npm run fixtures   # downloads the 2 raw radar files the decoder tests use (15 MB, gitignored)
npm test           # 20 tests: decoder vs Py-ART, rotation vs the Moore survey, links, LRU, packing
npm run dev        # http://localhost:5173
```

Claude preview entries (in `workspace/.claude/launch.json` and `.claude/launch.json`):
- `storm-replay`: dev server.
- `storm-replay-build`: `vite preview` of `dist/` under the real `/storm-replay/` sub-path (run `npm run build` first).

Data scripts (outputs are committed, so you only rerun these to change storms):
- `npm run build:storms [id]`: downloads the featured volumes (cached in `.cache/raw`), packs frames into `public/storms/<id>/`.
- `npm run build:overlays`: warning polygons (IEM) and damage paths (NWS DAT / SPC) into `public/storms/<id>/`.
- `npm run survey -- KTLX 2013-05-20T19:00Z 2013-05-20T21:00Z`: per-scan max dBZ and rotation detections, for picking windows.

## Status

| Milestone | State |
| --- | --- |
| 1. One scan on a map | Done 2026-10-13 |
| 2. Velocity + playback | **Done 2026-10-13** |
| 3. Curated replays | **Done 2026-10-13** |
| Extra: shareable links | **Done 2026-10-13** |
| Extra: warning polygons + damage paths | **Done 2026-10-13** |
| Extra: rotation highlighting | **Done 2026-10-13** |
| 4. Explore mode | Next (waiting on Justin's go-ahead) |
| 5. Polish + launch kit | |

### Session 2 (2026-10-13): M2, M3 and extras

- **Playback:** a pool of up to 3 decode workers, prefetch of 6 frames ahead, and an LRU of 40 decoded
  frames. Play/pause, scrub, step, speed (0.5×/1×/2×), and a buffer bar under the timeline. The loop
  waits for the next frame instead of skipping it.
- **Velocity:** a REF/VEL toggle (button or R/V) using an NWS-style green/red palette, with range folding in purple.
- **Featured storms:** Moore 2013 (17 scans), Joplin 2011 (16), Tuscaloosa 2011 (19), El Reno 2013 (16)
  and Mayfield 2021 (13) as one-click storyboards (Pittsburgh was dropped on 2026-10-14), with captions
  keyed to time and preprocessed `.srf` frames of ~220–485 KB each (vs 1.5–2.5 MB on the raw path). The first frame loaded in 181 ms in the worker (fetch + unpack +
  rotation, local server).
- **Links:** `#KTLX/2013-05-20T19:55Z/vel`. A featured window opens the storm; anything else streams
  ±45 min of raw volumes from the bucket (tested: `#KTLX/2013-05-31T23:10Z/vel`, El Reno day). The URL
  tracks the playhead; 🔗 copies it.
- **Overlays:** tornado warnings valid at the scan time, the surveyed damage path (solid up to "now"),
  and a "Tornado on the ground" line from the survey times.
- **Rotation:** a dealiased azimuthal-shear couplet detector in the worker, which hits the Moore
  touchdown within 2 km of the SPC point and follows the path east through Moore. See DECISIONS.
- **Verified:** dev and production (`/storm-replay/` sub-path) builds in the browser, desktop and
  375 px phone layouts, keyboard (space, ←/→, Home/End, R/V), and no app errors in the console.

## Next: milestone 4 (explore mode)

**First concrete step:** add `src/data/stations.ts` (NEXRAD ICAO, name, lat/lon, IANA time zone, which
is ~160 sites; NOAA publishes the list) and a station `<select>` + `<input type="datetime-local">` in
the panel that calls the existing `loadStation(route)` in `src/main.ts`. Then add the "latest" button
(list today's UTC prefix, take the last N), and explicit error states: no scans in the window, legacy
Message 1 (the decoder already throws `UnsupportedFormatError`), and network failure.

## Known issues

- **First-frame time can't be measured in the hidden Claude preview pane.** The map doesn't paint until
  the pane is shown, so it reads 13–18 s. Worker-side timings are real (181 ms for a packed frame).
  Measure time to first frame in a visible browser for the README (M5).
- Rotation misses weak, line-embedded spin-ups (Vrot < 20 m/s) and has occasional false alarms near the
  radar and at 100+ km. It's documented in the about panel as a demo, not a
  warning product.
- Joplin's and El Reno's damage paths are SPC's straight start→end segments (not in the DAT), so the
  couplet can sit a few km off them mid-path.
- Warning polygons are shown as issued (issuance → expiry); follow-up statements that shrink them
  aren't modelled.
- In stream mode, local time is the viewer's zone (stations have no time zone table until M4).
- The JS bundle is 296 KB gzipped, nearly all MapLibre. The worker bundle is 15 KB.
- OpenFreeMap asks for a glyph range it doesn't serve (U+104B0). It's a harmless basemap console warning.

## Later (ideas, not in scope yet)

- Hover or tap to read the value under the cursor (dBZ / m/s).
- Higher tilts (step up through the storm).
- Track rotation detections across scans and draw their path (the NWS MDA's time-association step, fully).
- A wasm bzip2 if raw-path playback gets CPU-bound on phones.
- Show warnings updated by follow-up statements (IEM's per-event SVS polygons).
