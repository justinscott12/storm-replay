// Playback over a list of scans: a playhead, play/pause at a frame rate, and a prefetcher that
// keeps the next few frames decoding in the workers. Decoded frames live in a bounded LRU so a
// long session can't grow memory without limit (~2-3 MB of grids per frame).
import type { Loaded, RadarClient } from '../radarClient';
import { Lru } from './lru';

export interface FrameRef {
  time: number;
  kind: 'archive' | 'packed';
  url: string;
}

export type FrameStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlayerOptions {
  /** Max decoded frames kept in memory. */
  cacheSize: number;
  /** Frames ahead of the playhead to keep decoding. */
  prefetch: number;
  /** How long the last frame holds before looping, in frame intervals. */
  endHold: number;
}

const DEFAULTS: PlayerOptions = { cacheSize: 40, prefetch: 6, endHold: 4 };

export interface PlayerEvents {
  /** A frame is now on screen. */
  frame: { index: number; loaded: Loaded };
  /** Play state / buffering changed. */
  state: { playing: boolean; buffering: boolean };
  /** A frame's load status changed (for the timeline buffer bar). */
  status: { index: number; status: FrameStatus; error?: Error };
}

export class Player {
  frames: FrameRef[] = [];
  index = -1;
  playing = false;
  buffering = false;
  fps = 4;

  private opts: PlayerOptions;
  private cache: Lru<string, Promise<Loaded>>;
  private statuses = new Map<string, FrameStatus>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seekToken = 0;
  private listeners = new Map<keyof PlayerEvents, ((e: never) => void)[]>();

  constructor(
    private readonly client: RadarClient,
    opts: Partial<PlayerOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.cache = new Lru(this.opts.cacheSize, (url) => {
      this.statuses.delete(url);
      const i = this.frames.findIndex((f) => f.url === url);
      if (i >= 0) this.emit('status', { index: i, status: 'idle' });
    });
  }

  on<K extends keyof PlayerEvents>(type: K, fn: (e: PlayerEvents[K]) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn as (e: never) => void);
    this.listeners.set(type, list);
  }

  private emit<K extends keyof PlayerEvents>(type: K, e: PlayerEvents[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (e: PlayerEvents[K]) => void)(e);
  }

  status(i: number): FrameStatus {
    const f = this.frames[i];
    return f ? (this.statuses.get(f.url) ?? 'idle') : 'idle';
  }

  /** Replace the scan list and show `start`. */
  async setFrames(frames: FrameRef[], start = 0): Promise<void> {
    this.pause();
    this.frames = frames;
    this.index = -1;
    await this.seek(start);
  }

  /** Load (or reuse) frame i. Never rejects into the cache twice: failed loads are evicted. */
  load(i: number): Promise<Loaded> {
    const f = this.frames[i];
    if (!f) return Promise.reject(new Error(`no frame ${i}`));
    const hit = this.cache.get(f.url);
    if (hit) return hit;
    this.setStatus(f.url, 'loading');
    const p = this.client.load(f.kind, f.url);
    this.cache.set(f.url, p);
    p.then(
      () => this.setStatus(f.url, 'ready'),
      (error: Error) => {
        this.cache.delete(f.url);
        this.setStatus(f.url, 'error', error);
      },
    );
    return p;
  }

  private setStatus(url: string, status: FrameStatus, error?: Error): void {
    this.statuses.set(url, status);
    this.frames.forEach((f, index) => {
      if (f.url === url) this.emit('status', { index, status, error });
    });
  }

  /** Show frame i as soon as it's decoded; a later seek supersedes an earlier pending one. */
  async seek(i: number): Promise<void> {
    if (this.frames.length === 0) return;
    const index = ((i % this.frames.length) + this.frames.length) % this.frames.length;
    const token = ++this.seekToken;
    this.prefetchFrom(index);
    try {
      const loaded = await this.load(index);
      if (token !== this.seekToken) return;
      this.index = index;
      this.emit('frame', { index, loaded });
    } catch {
      // Status already reports the error; the timeline marks the frame.
    }
  }

  step(delta: number): void {
    this.pause();
    void this.seek((this.index < 0 ? 0 : this.index) + delta);
  }

  private prefetchFrom(index: number): void {
    const n = this.frames.length;
    for (let k = 1; k <= Math.min(this.opts.prefetch, n - 1); k++) void this.load((index + k) % n).catch(() => {});
  }

  /** The previous frame if it's already decoded (used for time-associating rotation). */
  async cached(i: number): Promise<Loaded | null> {
    const f = this.frames[i];
    if (!f || this.statuses.get(f.url) !== 'ready') return null;
    return (await this.cache.get(f.url)) ?? null;
  }

  play(): void {
    if (this.playing || this.frames.length < 2) return;
    this.playing = true;
    this.emit('state', { playing: true, buffering: this.buffering });
    this.schedule(1000 / this.fps);
  }

  pause(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.playing) return;
    this.playing = false;
    this.buffering = false;
    this.emit('state', { playing: false, buffering: false });
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (!this.playing) return;
    const next = (this.index + 1) % this.frames.length;
    // Wait for the next frame instead of skipping it: radar loops are about continuity.
    if (this.status(next) !== 'ready') {
      this.setBuffering(true);
      const ok = await this.load(next).then(
        () => true,
        () => false,
      );
      if (!this.playing) return;
      if (!ok) {
        // Unloadable scan (missing/corrupt): step over it rather than stalling the loop.
        this.index = next;
        this.setBuffering(false);
        this.schedule(1000 / this.fps);
        return;
      }
    }
    this.setBuffering(false);
    await this.seek(next);
    if (!this.playing) return;
    const atEnd = next === this.frames.length - 1;
    this.schedule((1000 / this.fps) * (atEnd ? this.opts.endHold : 1));
  }

  private setBuffering(b: boolean): void {
    if (this.buffering === b) return;
    this.buffering = b;
    this.emit('state', { playing: this.playing, buffering: b });
  }
}
