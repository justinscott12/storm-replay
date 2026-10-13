// Shareable links: #KTLX/2013-05-20T19:55Z/vel opens that station at the nearest scan with that
// product. Featured storms are matched by station + time window, and anything else streams from the
// bucket.
import type { Product } from '../types';

export interface Route {
  station: string;
  time: number;
  product: Product;
}

const HASH_RE = /^#?([A-Za-z0-9]{4})\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)Z?(?:\/(ref|vel))?$/i;

export function parseHash(hash: string): Route | null {
  const m = HASH_RE.exec(decodeURIComponent(hash.trim()));
  if (!m) return null;
  const time = Date.parse(`${m[2]}Z`);
  if (Number.isNaN(time)) return null;
  return { station: m[1]!.toUpperCase(), time, product: m[3]?.toLowerCase() === 'vel' ? 'VEL' : 'REF' };
}

export function formatHash(r: Route): string {
  return `#${r.station}/${new Date(r.time).toISOString().slice(0, 16)}Z/${r.product.toLowerCase()}`;
}
