# Storm Replay

Replay real NEXRAD Doppler radar of historic tornadoes in your browser: the Moore, Oklahoma EF5's hook
echo and velocity couplet forming scan by scan. It's a static site with no backend. Featured storms
load small preprocessed frames, and links to any other station and time stream raw Level II volumes
straight from NOAA's archive and decode them in a Web Worker. Rendering is WebGL on a MapLibre map.

**Live: https://justinscott12.github.io/storm-replay/**

> Work in progress. See [PROGRESS.md](PROGRESS.md) for status and [docs/DECISIONS.md](docs/DECISIONS.md) for design notes.

- **Featured storms:** Moore 2013, Joplin 2011, Tuscaloosa 2011, El Reno 2013 and Mayfield 2021, with captions, NWS tornado warning
  polygons, and the surveyed damage path drawn in as the storm moves.
- **Reflectivity and velocity**, with play, scrub and speed controls, and keyboard shortcuts (space, ←/→, R/V).
- **Rotation markers** from an in-browser velocity-couplet detector, which finds the Moore tornado
  within 2 km of the surveyed touchdown point.
- **Share links** like `#KTLX/2013-05-20T19:55Z/vel` open any station and time.

```bash
npm install
npm run dev
```

Radar data: NOAA NEXRAD Level II via the `unidata-nexrad-level2` AWS Open Data bucket. Warnings: NWS
via the Iowa Environmental Mesonet. Damage paths: NWS Damage Assessment Toolkit and SPC. Basemap:
[OpenFreeMap](https://openfreemap.org) © OpenMapTiles, data from OpenStreetMap.
