# Build prompt: Storm Replay — a NEXRAD radar viewer that runs in the browser

You are building a public portfolio project for Justin, a full-stack engineer (TypeScript/React,
Python). Read this whole prompt before writing code. Work in bursts (milestones below); every
milestone must end in a committed, working state that someone can resume in five minutes.

## What we're building and why

A static web app, hosted free on GitHub Pages, that replays real NEXRAD Doppler radar data on a map
in the browser — no backend. The headline experience: open the link, press play, and watch the
Moore, Oklahoma tornado's hook echo and velocity couplet form, scan by scan.

It is a portfolio piece aimed at startup hiring managers and the weather community. It must:

1. **Impress within 10 seconds** of opening the link (a featured storm loads and plays fast).
2. **Show real engineering depth** Justin can talk about in a system-design interview: binary format
   decoding, GPU rendering, prefetch/caching, a performance budget.
3. **Cost $0 to run** forever: static files only.

It is a demo/prototype, not a product. No accounts, no analytics beyond what's free, no backend.

## Ground truth already verified (2026-10-13)

- **Data source:** the public AWS bucket `unidata-nexrad-level2` (`https://unidata-nexrad-level2.s3.amazonaws.com`)
  allows browser requests: `Access-Control-Allow-Origin: *`, `GET, HEAD`. List with
  `?list-type=2&prefix=YYYY/MM/DD/SITE/`. Keys look like `2013/05/20/KTLX/KTLX20130520_190411_V06.gz`.
  It archives 1991 → minutes ago, so a "latest scans" mode is possible.
  (The similarly named `noaa-nexrad-level2` bucket returns 403 — don't use it.)
- **Featured storms confirmed present:**
  - Moore, OK EF5 — `KTLX`, 2013-05-20, roughly 19:30–20:45 UTC (touchdown ~19:56 UTC). `_V06.gz`, ~6–9 MB each.
  - Joplin, MO EF5 — `KSGF`, 2011-05-22, roughly 22:00–23:15 UTC (touchdown ~22:34 UTC). `_V03.gz`, ~3.4 MB each.
  - Justin's own storm — `KPBZ` (Pittsburgh), 2026-06-06, from ~03:05 UTC. `_V06` (no `.gz`), ~7 MB each.
  Verify the exact time windows against the data before hardcoding.
- **Format gotchas you must handle:**
  - Older keys end in `.gz`: the whole Archive II file is gzip-wrapped. Newer keys are raw.
  - Inside, Archive II is a 24-byte volume header then LDM records, each bzip2-compressed, containing
    Message 31 (generic digital radar data) for these years. Older archives (pre-~2008) use Message 1;
    supporting those is out of scope — fail gracefully with a clear message.
  - Files are large (3–9 MB) but the lowest tilt (0.5°) is at the start of the volume. Decoding only the
    first sweep is the main performance lever.
- **Existing prototype:** this folder (`radar-viewer/`) has a Python/Py-ART + matplotlib scrubber
  (`scope.py`, `view.py`, `radar_common.py`). Use it as a reference for field ranges
  (`FIELD_LIMITS`: reflectivity −10..70 dBZ, velocity −30..30 m/s) and as a correctness oracle:
  `python view.py <file> --field velocity` renders a known-good image to compare against.

## Hard constraints

- Static site only: build output must deploy to GitHub Pages under a sub-path
  (`https://justinscott12.github.io/<repo>/`). Set the bundler's base path accordingly.
- TypeScript, strict mode. Vite. Keep dependencies few and justified.
- No API keys, no secrets, no paid services. Basemap tiles must be free/keyless (e.g. OpenFreeMap or
  a free MapLibre style) — check terms before use and credit them.
- Decoding happens off the main thread (Web Worker). UI never freezes during a download or decode.
- Works on a phone (touch scrub, readable at 375px wide) and on desktop.
- Accessible basics: keyboard play/pause (space) and scrub (arrows), sufficient contrast, reduced-motion respected.
- Do NOT create the GitHub repo, push, or enable Pages without asking Justin first — those are public.
  Commit locally freely.

## Architecture direction (decide details yourself, record decisions in `docs/DECISIONS.md`)

- **Two data paths:**
  1. *Curated replays* (the 10-second wow): consider a build-time preprocessing script that pulls the
     featured scans, extracts the lowest-tilt reflectivity + velocity, quantizes to compact binary
     (e.g. uint8 per gate + a small header), and commits small static assets. First frame should paint
     fast without downloading 60 MB of raw volumes.
  2. *Explore mode* (the engineering flex): pick any station + date/time, list the bucket, fetch and decode
     raw Archive II in the browser worker. Stream-decompress and stop after the first sweep.
  Measure before committing to this split; if in-browser decode is fast enough for curated storms too,
  say so with numbers and simplify.
- **Decoder:** first spend ≤1 hour checking whether an existing JS Archive II parser (e.g. the
  `nexrad-level-2-data` npm package) runs in a browser worker. If it does, use it and spend the effort on
  rendering. If it's Node-only, write a small focused decoder (volume header → bzip2 records →
  Message 31 → REF/VEL moments) with unit tests against a real file. Either way, document the choice.
- **Rendering:** WebGL (direct, or via a MapLibre custom layer / deck.gl) drawing polar gates
  (azimuth × range) projected around the radar site. Color tables for reflectivity and velocity that
  match standard NWS conventions. Toggle between reflectivity and velocity.
- **Playback:** timeline of scans with timestamps (UTC + local), play/pause, speed, scrub; prefetch and
  decode the next N frames ahead of the playhead with a bounded cache (LRU) so playback is smooth.

## Milestones (each one: working, verified, committed, `PROGRESS.md` updated)

1. **One scan on a map.** Vite + TS scaffold, basemap, decode one KTLX 2013-05-20 scan, render 0.5°
   reflectivity in the right place. Verify against `python view.py` output for the same file.
2. **Velocity + playback.** Velocity toggle, timeline, play/scrub, worker decode, prefetch + LRU cache.
3. **Curated replays.** Moore, Joplin, KPBZ June 6 as one-click storyboards with a short caption each
   ("watch the couplet tighten at 19:5x UTC"). Fast first paint (see data path 1).
4. **Explore mode.** Station picker (list of NEXRAD sites with coordinates), date/time, "latest" button.
   Clear loading/error states (missing scans, unsupported old format, network failure).
5. **Polish + launch kit.** Mobile pass, keyboard controls, about panel crediting data/tile sources,
   README with a GIF of Moore playing, a "How it works" section (format, worker, WebGL, caching, numbers),
   GitHub Actions workflow to build + deploy Pages. Stop and ask Justin before the first push.

Performance budget to report in the README (measured, not guessed): time to first frame for a curated
storm, decode time per scan in the worker, bytes downloaded per frame, playback FPS on a mid-range phone
emulation.

## Resumability (non-negotiable)

Justin works in bursts with gaps of days or weeks. Keep at repo root:
- `PROGRESS.md` — what's done, what's next (one concrete first step), known issues. Update at the end of
  every milestone and every session.
- `docs/DECISIONS.md` — short entries: decision, why, alternatives rejected.
- A `npm run dev` that just works, and a `.claude/launch.json` entry so the preview can be started by name.

## Verification

Run the app in the browser preview after every milestone. Check the console for errors, confirm the
storm renders in the right geographic location (the Moore hook should sit just south of Oklahoma City,
SW of the KTLX site), compare a frame against the Python prototype, and take a screenshot. Don't claim a
milestone is done without that evidence.

## Out of scope (do not build)

Forecasting/ML, accounts, alerts/notifications, a backend or serverless functions, 3D volume rendering,
dual-pol products beyond reflectivity/velocity, pre-2008 Message 1 archives, monetization.
Note good ideas in `PROGRESS.md` under "Later" instead.

## Start here

Read the Python prototype, fetch one KTLX 2013-05-20 scan from the bucket, do the decoder spike, then
propose the repo name and a one-paragraph plan for milestone 1 before scaffolding.
