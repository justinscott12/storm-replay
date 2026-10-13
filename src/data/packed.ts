// "SRF1" packed frame: the preprocessed format for curated storms. It's just the decoder's output
// (azimuth-binned uint8 grids + metadata), so the worker skips fetching and parsing a raw volume.
//   bytes 0-3   "SRF1"
//   bytes 4-7   uint32 LE header length N
//   bytes 8..   N bytes of JSON: frame metadata + per-moment geometry
//   then        REF grid, then VEL grid (if any), rows x gates bytes each
// Files are gzipped as a whole at build time; the worker gunzips with DecompressionStream.
import type { Frame, FrameMoment } from '../types';

const MAGIC = 'SRF1';
type MomentMeta = Omit<FrameMoment, 'grid'>;
interface Header extends Omit<Frame, 'ref' | 'vel' | 'rotations'> {
  ref: MomentMeta;
  vel: MomentMeta | null;
}

const meta = ({ grid: _grid, ...rest }: FrameMoment): MomentMeta => rest;

export function packFrame(frame: Frame): Uint8Array {
  const header: Header = {
    station: frame.station,
    lat: frame.lat,
    lon: frame.lon,
    time: frame.time,
    vcp: frame.vcp,
    ref: meta(frame.ref),
    vel: frame.vel ? meta(frame.vel) : null,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + frame.ref.grid.length + (frame.vel?.grid.length ?? 0));
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(frame.ref.grid, 8 + json.length);
  if (frame.vel) out.set(frame.vel.grid, 8 + json.length + frame.ref.grid.length);
  return out;
}

export function unpackFrame(bytes: Uint8Array): Frame {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('not a packed Storm Replay frame');
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n))) as Header;
  let p = 8 + n;
  const take = (m: MomentMeta): FrameMoment => {
    const grid = bytes.slice(p, p + m.rows * m.gates);
    p += grid.length;
    return { ...m, grid };
  };
  const ref = take(header.ref);
  const vel = header.vel ? take(header.vel) : null;
  return { ...header, ref, vel, rotations: [] };
}
