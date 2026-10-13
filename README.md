# Storm Replay

Replay real NEXRAD Doppler radar scans in your browser: a static site with no backend. It
fetches Level II volumes straight from NOAA's public archive (via Unidata's AWS bucket), decodes them
in a Web Worker, and draws them with WebGL on a MapLibre map.

> Work in progress. See [PROGRESS.md](PROGRESS.md) for status and [docs/DECISIONS.md](docs/DECISIONS.md) for design notes.

```bash
npm install
npm run dev
```

Radar data: NOAA NEXRAD Level II via the `unidata-nexrad-level2` AWS Open Data bucket. Basemap:
[OpenFreeMap](https://openfreemap.org) © OpenMapTiles, data from OpenStreetMap.
