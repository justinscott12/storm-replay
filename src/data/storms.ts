// Curated storms: the one-click replays. Times are UTC. `beats` are the captions shown as the
// playhead passes each time. Frames are preprocessed by scripts/build-storms.ts into
// public/storms/<id>/ (see docs/DECISIONS.md, "curated data path").

export interface Beat {
  /** ISO UTC time the caption becomes active. */
  at: string;
  text: string;
}

export interface StormDef {
  id: string;
  title: string;
  subtitle: string;
  station: string;
  /** IANA zone for local-time display. */
  timeZone: string;
  /** Inclusive UTC window of volume scans to include. */
  start: string;
  end: string;
  /** Frame to open on (nearest scan), and product. */
  focus: string;
  product: 'REF' | 'VEL';
  /** Initial map view. */
  center: [number, number];
  zoom: number;
  beats: Beat[];
  /** Short attribution / source line for the overlays. */
  sources: string;
}

export const STORMS: StormDef[] = [
  {
    id: 'moore-2013',
    title: 'Moore, Oklahoma',
    subtitle: 'EF5 tornado · May 20, 2013',
    station: 'KTLX',
    timeZone: 'America/Chicago',
    start: '2013-05-20T19:30:00Z',
    end: '2013-05-20T20:45:00Z',
    focus: '2013-05-20T19:55:00Z',
    product: 'REF',
    center: [-97.47, 35.3],
    zoom: 9.3,
    beats: [
      { at: '2013-05-20T19:30:00Z', text: 'A supercell drifts east toward Oklahoma City. Watch its southwest flank, near Newcastle.' },
      { at: '2013-05-20T19:50:00Z', text: 'The hook echo wraps up west of Newcastle. In velocity, red and green pinch together: rotation.' },
      { at: '2013-05-20T19:56:00Z', text: 'Touchdown at 2:56 pm CDT west of Newcastle. The couplet tightens as it crosses the Canadian River.' },
      { at: '2013-05-20T20:10:00Z', text: 'The EF5 tornado tracks through Moore, through neighborhoods and two elementary schools.' },
      { at: '2013-05-20T20:30:00Z', text: 'It lifts east of Moore at 3:35 pm CDT after 39 minutes and about 14 miles.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage path: NWS Damage Assessment Toolkit.',
  },
  {
    id: 'joplin-2011',
    title: 'Joplin, Missouri',
    subtitle: 'EF5 tornado · May 22, 2011',
    station: 'KSGF',
    timeZone: 'America/Chicago',
    start: '2011-05-22T22:00:00Z',
    end: '2011-05-22T23:15:00Z',
    focus: '2011-05-22T22:34:00Z',
    product: 'REF',
    center: [-94.45, 37.08],
    zoom: 9.2,
    beats: [
      { at: '2011-05-22T22:00:00Z', text: 'Storms fire along the Kansas–Missouri line, about 110 km west of the Springfield radar.' },
      { at: '2011-05-22T22:25:00Z', text: 'One cell becomes dominant just west of Joplin as rotation strengthens.' },
      { at: '2011-05-22T22:34:00Z', text: 'Touchdown at 5:34 pm CDT on the southwest edge of Joplin. The tornado is wrapped in rain.' },
      { at: '2011-05-22T22:40:00Z', text: 'The EF5 tornado crosses the city from west to east, nearly a mile wide.' },
      { at: '2011-05-22T23:05:00Z', text: 'It weakens east of town after a 22-mile path.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage path: SPC tornado database.',
  },
  {
    id: 'pittsburgh-2026',
    title: 'Pittsburgh, Pennsylvania',
    subtitle: 'Six EF1 tornadoes · June 6, 2026',
    station: 'KPBZ',
    timeZone: 'America/New_York',
    start: '2026-06-06T18:15:00Z',
    end: '2026-06-06T19:20:00Z',
    focus: '2026-06-06T18:42:00Z',
    product: 'VEL',
    center: [-79.95, 40.12],
    zoom: 9.2,
    beats: [
      { at: '2026-06-06T18:15:00Z', text: 'A line of storms sweeps east across southwest Pennsylvania, about 50 km south of the radar.' },
      { at: '2026-06-06T18:36:00Z', text: 'Small kinks form along the line. In velocity, look for tight red/green pairs on its leading edge.' },
      { at: '2026-06-06T18:38:00Z', text: 'Brief EF1 tornadoes spin up near Beallsville, Ellsworth and Centerville from 2:38 pm EDT.' },
      { at: '2026-06-06T18:50:00Z', text: 'More touch down near Brownsville, Perryopolis and Smithton: six EF1 tornadoes in 22 minutes.' },
      { at: '2026-06-06T19:05:00Z', text: 'Line-embedded spin-ups like these are small and short-lived, below this viewer\'s rotation threshold.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage paths: NWS Damage Assessment Toolkit.',
  },
];

export const stormById = (id: string) => STORMS.find((s) => s.id === id);

/** Manifest written by scripts/build-storms.ts next to the packed frames. */
export interface StormManifest {
  id: string;
  station: string;
  frames: { time: number; file: string; bytes: number }[];
  overlays: { warnings: string | null; track: string | null };
}
