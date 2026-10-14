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
    id: 'tuscaloosa-2011',
    title: 'Tuscaloosa, Alabama',
    subtitle: 'EF4 tornado · April 27, 2011',
    station: 'KBMX',
    timeZone: 'America/Chicago',
    start: '2011-04-27T21:40:00Z',
    end: '2011-04-27T23:15:00Z',
    focus: '2011-04-27T22:10:00Z',
    product: 'REF',
    center: [-87.35, 33.33],
    zoom: 8.5,
    beats: [
      { at: '2011-04-27T21:40:00Z', text: 'The worst day of the April 2011 Super Outbreak. A supercell moves into west Alabama.' },
      { at: '2011-04-27T21:43:00Z', text: 'The Tuscaloosa–Birmingham tornado touches down in Greene County at 4:43 pm CDT.' },
      { at: '2011-04-27T22:05:00Z', text: 'It tears across Tuscaloosa around 5:10 pm CDT, up to 1.5 miles wide.' },
      { at: '2011-04-27T22:35:00Z', text: 'Still on the ground, it heads northeast into the western suburbs of Birmingham.' },
      { at: '2011-04-27T23:05:00Z', text: 'It lifts at 6:14 pm CDT after 80 miles. 64 people were killed.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage path: NWS Damage Assessment Toolkit.',
  },
  {
    id: 'el-reno-2013',
    title: 'El Reno, Oklahoma',
    subtitle: 'Widest tornado on record · May 31, 2013',
    station: 'KTLX',
    timeZone: 'America/Chicago',
    start: '2013-05-31T22:40:00Z',
    end: '2013-05-31T23:55:00Z',
    focus: '2013-05-31T23:10:00Z',
    product: 'VEL',
    center: [-97.97, 35.5],
    zoom: 9.6,
    beats: [
      { at: '2013-05-31T22:40:00Z', text: 'Eleven days after Moore, a supercell west of Oklahoma City heads toward El Reno.' },
      { at: '2013-05-31T23:03:00Z', text: 'Touchdown at 6:03 pm CDT south of El Reno, in open country.' },
      { at: '2013-05-31T23:15:00Z', text: 'It balloons to 2.6 miles wide, the widest tornado ever recorded, and turns erratically.' },
      { at: '2013-05-31T23:25:00Z', text: 'It killed eight people, including storm researchers Tim Samaras, Paul Samaras and Carl Young.' },
      { at: '2013-05-31T23:40:00Z', text: 'It lifts at 6:43 pm CDT. Rated EF3 from damage, though mobile radar measured winds near 300 mph.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage path: SPC tornado database.',
  },
  {
    id: 'mayfield-2021',
    title: 'Mayfield, Kentucky',
    subtitle: 'EF4 tornado · December 10, 2021',
    station: 'KPAH',
    timeZone: 'America/Chicago',
    start: '2021-12-11T02:45:00Z',
    end: '2021-12-11T04:10:00Z',
    focus: '2021-12-11T03:26:00Z',
    product: 'REF',
    center: [-88.55, 36.85],
    zoom: 8.7,
    beats: [
      { at: '2021-12-11T02:45:00Z', text: 'A December supercell crosses northwest Tennessee toward the Kentucky line.' },
      { at: '2021-12-11T02:49:00Z', text: 'Its long-track tornado touches down in Tennessee at about 8:49 pm CST.' },
      { at: '2021-12-11T03:20:00Z', text: 'It hits downtown Mayfield around 9:26 pm CST, levelling the courthouse square and a candle factory.' },
      { at: '2021-12-11T03:40:00Z', text: 'Moving at about 55 mph, the couplet races northeast toward Princeton and Dawson Springs.' },
      { at: '2021-12-11T04:00:00Z', text: 'It stays down until 11:47 pm CST: 165 miles, with 57 deaths.' },
    ],
    sources: 'Warning polygons: NWS via Iowa Environmental Mesonet. Damage path: NWS Damage Assessment Toolkit.',
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
