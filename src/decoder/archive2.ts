// NEXRAD Archive II decoder, focused on what the viewer needs: the lowest-tilt reflectivity and
// velocity sweeps. It is incremental (feed it bytes as they arrive) and reports when it has
// enough, so callers can stop downloading/decompressing after ~15-35% of the file.
//
// Layout (ICD 2620010 / 2620002):
//   24-byte volume header: "AR2V00xx.nnn", julian date, ms, ICAO
//   then either
//     - LDM records: int32 size + bzip2 stream, each holding whole messages (raw keys, ~2008+)
//     - the message stream directly (Unidata's .gz archive keys: gunzip and it's uncompressed)
//   message = 12-byte CTM padding + 16-byte header + body
//     type 31 (generic radial): variable length, size in halfwords at header[0]
//     every other type occupies a fixed 2432-byte frame
//   type 1 = legacy pre-2008 radial format: not supported.

import { bunzip2 } from './bzip2';

export type MomentName = 'REF' | 'VEL';

export interface Sweep {
  moment: MomentName;
  elevationNumber: number;
  /** Mean elevation angle of the sweep's radials, degrees. */
  elevationDeg: number;
  radials: number;
  gates: number;
  /** Range to the centre of the first gate, metres. */
  firstGateM: number;
  gateSpacingM: number;
  /** physical value = (code - offset) / scale. Codes 0 (below threshold) and 1 (range folded) are flags. */
  scale: number;
  offset: number;
  /** Azimuth of each radial, degrees clockwise from north, in collection order. */
  azimuths: Float32Array;
  /** radials x gates codes, row-major by radial. */
  data: Uint8Array;
}

export interface Scan {
  station: string;
  /** Volume coverage pattern number. */
  vcp: number;
  lat: number;
  lon: number;
  siteHeightM: number;
  /** Collection time of the first radial (ms since epoch, UTC). */
  time: number;
  ref: Sweep;
  vel: Sweep | null;
}

export class UnsupportedFormatError extends Error {
  override name = 'UnsupportedFormatError';
}

export class DecodeError extends Error {
  override name = 'DecodeError';
}

const VOLUME_HEADER = 24;
const CTM = 12;
const MSG_HEADER = 16;
const FIXED_FRAME = 2432;
const MS_PER_DAY = 86_400_000;

interface MomentRef {
  offset: number;
  gates: number;
  firstGateM: number;
  gateSpacingM: number;
  wordSize: number;
  scale: number;
  offset0: number;
}

class SweepBuilder {
  readonly azimuths: number[] = [];
  readonly elevations: number[] = [];
  readonly rows: Uint8Array[] = [];
  gates = 0;
  firstGateM = 0;
  gateSpacingM = 0;
  scale = 1;
  offset = 0;

  constructor(
    readonly moment: MomentName,
    readonly elevationNumber: number,
  ) {}

  add(bytes: Uint8Array, m: MomentRef, azimuth: number, elevation: number): void {
    if (m.wordSize !== 8) throw new DecodeError(`${this.moment}: unexpected ${m.wordSize}-bit gates`);
    if (this.rows.length === 0) {
      this.gates = m.gates;
      this.firstGateM = m.firstGateM;
      this.gateSpacingM = m.gateSpacingM;
      this.scale = m.scale;
      this.offset = m.offset0;
    }
    const row = new Uint8Array(this.gates);
    row.set(bytes.subarray(m.offset, m.offset + Math.min(m.gates, this.gates)));
    this.rows.push(row);
    this.azimuths.push(azimuth);
    this.elevations.push(elevation);
  }

  build(): Sweep {
    const data = new Uint8Array(this.rows.length * this.gates);
    this.rows.forEach((row, i) => data.set(row, i * this.gates));
    const elevationDeg = this.elevations.reduce((a, b) => a + b, 0) / Math.max(1, this.elevations.length);
    return {
      moment: this.moment,
      elevationNumber: this.elevationNumber,
      elevationDeg,
      radials: this.rows.length,
      gates: this.gates,
      firstGateM: this.firstGateM,
      gateSpacingM: this.gateSpacingM,
      scale: this.scale,
      offset: this.offset,
      azimuths: Float32Array.from(this.azimuths),
      data,
    };
  }
}

/**
 * Consumes Archive II message-stream bytes (already outside any LDM/bzip2 framing) and collects
 * the lowest REF and VEL sweeps. Messages may straddle chunk boundaries.
 */
export class MessageCollector {
  private pending: Uint8Array = new Uint8Array(0);
  private ref: SweepBuilder | null = null;
  private vel: SweepBuilder | null = null;
  private done = false;
  station = '';
  vcp = 0;
  lat = NaN;
  lon = NaN;
  siteHeightM = 0;
  time = NaN;

  get isDone(): boolean {
    return this.done;
  }

  /** Feed bytes. Returns true once both lowest sweeps are complete. */
  push(chunk: Uint8Array): boolean {
    if (this.done) return true;
    let buf: Uint8Array;
    if (this.pending.length) {
      buf = new Uint8Array(this.pending.length + chunk.length);
      buf.set(this.pending);
      buf.set(chunk, this.pending.length);
    } else {
      buf = chunk;
    }
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 0;
    while (!this.done && p + CTM + MSG_HEADER <= buf.length) {
      const sizeHalfwords = dv.getUint16(p + CTM);
      const type = dv.getUint8(p + CTM + 3);
      let size: number;
      if (type === 31) {
        size = CTM + sizeHalfwords * 2;
      } else if (type === 1) {
        throw new UnsupportedFormatError(
          'This scan uses the legacy Message 1 format (archives before ~2008), which Storm Replay does not decode.',
        );
      } else {
        size = FIXED_FRAME;
      }
      if (size < CTM + MSG_HEADER) throw new DecodeError(`bad message size ${size} (type ${type})`);
      if (p + size > buf.length) break;
      if (type === 31) this.radial(buf, dv, p + CTM + MSG_HEADER);
      p += size;
    }
    this.pending = this.done ? new Uint8Array(0) : buf.slice(p);
    return this.done;
  }

  /** Finish after the stream ended (e.g. a short volume). */
  finish(): Scan {
    if (!this.ref || this.ref.rows.length === 0) throw new DecodeError('no reflectivity radials found');
    return {
      station: this.station,
      vcp: this.vcp,
      lat: this.lat,
      lon: this.lon,
      siteHeightM: this.siteHeightM,
      time: this.time,
      ref: this.ref.build(),
      vel: this.vel && this.vel.rows.length ? this.vel.build() : null,
    };
  }

  private radial(bytes: Uint8Array, dv: DataView, o: number): void {
    const elevNum = dv.getUint8(o + 22);
    if (Number.isNaN(this.time)) {
      this.station = String.fromCharCode(...bytes.subarray(o, o + 4));
      const ms = dv.getUint32(o + 4);
      const julian = dv.getUint16(o + 8);
      this.time = (julian - 1) * MS_PER_DAY + ms;
    }

    // Done once we're past the elevation(s) holding the lowest REF and VEL.
    if (this.ref && elevNum > this.ref.elevationNumber && (this.vel ? elevNum > this.vel.elevationNumber : elevNum > 3)) {
      this.done = true;
      return;
    }

    const azimuth = dv.getFloat32(o + 12);
    const elevation = dv.getFloat32(o + 24);
    const blocks = dv.getUint16(o + 30);
    for (let i = 0; i < blocks && i < 10; i++) {
      const b = o + dv.getUint32(o + 32 + 4 * i);
      if (b + 28 > bytes.length) continue;
      const name = String.fromCharCode(bytes[b + 1]!, bytes[b + 2]!, bytes[b + 3]!);
      if (name === 'VOL' && Number.isNaN(this.lat)) {
        this.lat = dv.getFloat32(b + 8);
        this.lon = dv.getFloat32(b + 12);
        this.siteHeightM = dv.getInt16(b + 16);
        this.vcp = dv.getUint16(b + 40);
      } else if (name === 'REF' || name === 'VEL') {
        const m: MomentRef = {
          offset: b + 28,
          gates: dv.getUint16(b + 8),
          firstGateM: dv.getInt16(b + 10),
          gateSpacingM: dv.getInt16(b + 12),
          wordSize: dv.getUint8(b + 19),
          scale: dv.getFloat32(b + 20),
          offset0: dv.getFloat32(b + 24),
        };
        if (name === 'REF') {
          this.ref ??= new SweepBuilder('REF', elevNum);
          if (this.ref.elevationNumber === elevNum) this.ref.add(bytes, m, azimuth, elevation);
        } else {
          this.vel ??= new SweepBuilder('VEL', elevNum);
          if (this.vel.elevationNumber === elevNum) this.vel.add(bytes, m, azimuth, elevation);
        }
      }
    }
  }
}

export interface DecodeStats {
  /** Time spent in bzip2 + message parsing (excludes waiting for the network). */
  decodeMs: number;
  /** Decompressed bytes handed to the message parser. */
  messageBytes: number;
}

/**
 * Consumes a (gunzipped) Archive II file in arbitrary chunks: volume header, then either LDM
 * bzip2 records or a bare message stream.
 */
export class Archive2Reader {
  readonly collector = new MessageCollector();
  readonly stats: DecodeStats = { decodeMs: 0, messageBytes: 0 };
  private head: Uint8Array = new Uint8Array(0);
  private mode: 'header' | 'ldm' | 'messages' = 'header';
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Feed file bytes. Returns true when the lowest sweeps are complete (stop reading). */
  push(chunk: Uint8Array): boolean {
    const t0 = this.now();
    try {
      return this.consume(chunk);
    } finally {
      this.stats.decodeMs += this.now() - t0;
    }
  }

  finish(): Scan {
    return this.collector.finish();
  }

  private consume(chunk: Uint8Array): boolean {
    let buf = concat(this.head, chunk);
    if (this.mode === 'header') {
      if (buf.length < VOLUME_HEADER + 8) {
        this.head = buf;
        return false;
      }
      const tag = String.fromCharCode(...buf.subarray(0, 4));
      if (tag !== 'AR2V') {
        if (tag.startsWith('ARCH')) {
          throw new UnsupportedFormatError('This is a legacy (pre-2008) archive, which Storm Replay does not decode.');
        }
        throw new DecodeError(`not an Archive II file (starts with "${tag}")`);
      }
      const isBzip = buf[VOLUME_HEADER + 4] === 0x42 && buf[VOLUME_HEADER + 5] === 0x5a && buf[VOLUME_HEADER + 6] === 0x68;
      this.mode = isBzip ? 'ldm' : 'messages';
      buf = buf.subarray(VOLUME_HEADER);
    }

    if (this.mode === 'messages') {
      this.head = new Uint8Array(0);
      this.stats.messageBytes += buf.length;
      return this.collector.push(buf);
    }

    // LDM records: int32 size (sign is a continuation flag) + one bzip2 stream.
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 0;
    while (p + 4 <= buf.length) {
      const size = Math.abs(dv.getInt32(p));
      if (p + 4 + size > buf.length) break;
      const messages = bunzip2(buf.subarray(p + 4, p + 4 + size));
      p += 4 + size;
      this.stats.messageBytes += messages.length;
      if (this.collector.push(messages)) {
        this.head = new Uint8Array(0);
        return true;
      }
    }
    this.head = buf.slice(p);
    return false;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Decode a whole in-memory file (already gunzipped). Convenience for tests and tools. */
export function decodeArchive2(file: Uint8Array): Scan {
  const reader = new Archive2Reader();
  reader.push(file);
  return reader.finish();
}
