// A small bzip2 decompressor. NEXRAD Archive II files written since ~2008 store each LDM record
// as an independent bzip2 stream, and browsers have no built-in bzip2 (DecompressionStream only
// does gzip/deflate), so we decode it ourselves. Structure follows the reference implementation:
// Huffman + MTF/RLE2 decode -> inverse Burrows-Wheeler transform -> RLE1 decode.
// Block CRCs are not verified; corrupt input fails on structural checks instead.

const BLOCK_MAGIC_HI = 0x314159;
const BLOCK_MAGIC_LO = 0x265359;
const END_MAGIC_HI = 0x177245;
const END_MAGIC_LO = 0x385090;
const MAX_GROUPS = 6;
const MAX_ALPHA = 258;
const MAX_CODE_LEN = 20;
const GROUP_SIZE = 50;

export class Bzip2Error extends Error {
  override name = 'Bzip2Error';
}

class BitReader {
  private pos = 0;
  private acc = 0;
  private count = 0;

  constructor(private readonly data: Uint8Array) {}

  /** Read n bits (n <= 24), most significant bit first. */
  bits(n: number): number {
    while (this.count < n) {
      if (this.pos >= this.data.length) throw new Bzip2Error('unexpected end of bzip2 data');
      this.acc = (this.acc << 8) | this.data[this.pos++]!;
      this.count += 8;
    }
    this.count -= n;
    return (this.acc >>> this.count) & ((1 << n) - 1);
  }

  bit(): number {
    return this.bits(1);
  }

  /** Skip to the next byte boundary; true if another 'BZh' stream starts there. */
  nextStream(): boolean {
    this.count -= this.count % 8;
    const at = this.pos - this.count / 8;
    const d = this.data;
    if (at + 3 >= d.length || d[at] !== 0x42 || d[at + 1] !== 0x5a || d[at + 2] !== 0x68) return false;
    this.pos = at;
    this.count = 0;
    this.acc = 0;
    return true;
  }
}

class Output {
  buf: Uint8Array;
  len = 0;

  constructor(sizeHint: number) {
    this.buf = new Uint8Array(Math.max(sizeHint, 1024));
  }

  ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
}

/** Decompress one or more concatenated bzip2 streams. */
export function bunzip2(input: Uint8Array, sizeHint = input.length * 5): Uint8Array {
  const br = new BitReader(input);
  const out = new Output(sizeHint);
  let tt = new Uint32Array(0);

  for (;;) {
    if (br.bits(8) !== 0x42 || br.bits(8) !== 0x5a || br.bits(8) !== 0x68) {
      throw new Bzip2Error('missing BZh stream header');
    }
    const level = br.bits(8) - 0x30;
    if (level < 1 || level > 9) throw new Bzip2Error(`bad block size ${level}`);
    const maxBlock = level * 100_000;
    if (tt.length < maxBlock) tt = new Uint32Array(maxBlock);

    for (;;) {
      const hi = br.bits(24);
      const lo = br.bits(24);
      if (hi === END_MAGIC_HI && lo === END_MAGIC_LO) {
        br.bits(16); // stream CRC
        br.bits(16);
        break;
      }
      if (hi !== BLOCK_MAGIC_HI || lo !== BLOCK_MAGIC_LO) throw new Bzip2Error('bad block magic');
      br.bits(16); // block CRC
      br.bits(16);
      decodeBlock(br, tt, maxBlock, out);
    }

    // Another stream may follow (byte-aligned).
    if (!br.nextStream()) break;
  }
  return out.buf.subarray(0, out.len);
}


function decodeBlock(br: BitReader, tt: Uint32Array, maxBlock: number, out: Output): void {
  if (br.bit()) throw new Bzip2Error('randomised blocks are not supported');
  const origPtr = br.bits(24);

  // Which byte values appear in the block.
  const seqToUnseq = new Uint8Array(256);
  let numInUse = 0;
  const inUse16 = br.bits(16);
  for (let i = 0; i < 16; i++) {
    if (!(inUse16 & (0x8000 >>> i))) continue;
    const bitsUsed = br.bits(16);
    for (let j = 0; j < 16; j++) {
      if (bitsUsed & (0x8000 >>> j)) seqToUnseq[numInUse++] = i * 16 + j;
    }
  }
  if (numInUse === 0) throw new Bzip2Error('empty symbol map');
  const alphaSize = numInUse + 2;
  const eob = numInUse + 1;

  const nGroups = br.bits(3);
  if (nGroups < 2 || nGroups > MAX_GROUPS) throw new Bzip2Error(`bad group count ${nGroups}`);
  const nSelectors = br.bits(15);
  if (nSelectors < 1) throw new Bzip2Error('no selectors');

  // Selectors are MTF-coded unary group indices.
  const selectorMtf = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
  const selectors = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (br.bit()) {
      if (++j >= nGroups) throw new Bzip2Error('bad selector');
    }
    const g = selectorMtf[j]!;
    selectorMtf.splice(j, 1);
    selectorMtf.unshift(g);
    selectors[i] = g;
  }

  // Delta-coded Huffman code lengths, then canonical decode tables per group.
  const limit: Int32Array[] = [];
  const delta: Int32Array[] = [];
  const perm: Uint16Array[] = [];
  const minLens = new Int32Array(nGroups);
  const lengths = new Uint8Array(MAX_ALPHA);
  for (let g = 0; g < nGroups; g++) {
    let curr = br.bits(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (curr < 1 || curr > MAX_CODE_LEN) throw new Bzip2Error('bad code length');
        if (!br.bit()) break;
        curr += br.bit() ? -1 : 1;
      }
      lengths[s] = curr;
    }
    let minLen = MAX_CODE_LEN;
    let maxLen = 0;
    for (let s = 0; s < alphaSize; s++) {
      minLen = Math.min(minLen, lengths[s]!);
      maxLen = Math.max(maxLen, lengths[s]!);
    }
    const lim = new Int32Array(MAX_CODE_LEN + 2).fill(-1);
    const del = new Int32Array(MAX_CODE_LEN + 2);
    const pm = new Uint16Array(alphaSize);
    let pp = 0;
    let code = 0;
    for (let len = minLen; len <= maxLen; len++) {
      const firstIdx = pp;
      for (let s = 0; s < alphaSize; s++) if (lengths[s] === len) pm[pp++] = s;
      const n = pp - firstIdx;
      del[len] = firstIdx - code;
      lim[len] = code + n - 1;
      code = (code + n) << 1;
    }
    lim[maxLen + 1] = 0x7fffffff; // unreachable sentinel: a code longer than maxLen is corrupt
    limit.push(lim);
    delta.push(del);
    perm.push(pm);
    minLens[g] = minLen;
  }

  // Huffman -> RUNA/RUNB run lengths + move-to-front -> pre-BWT bytes in tt (low 8 bits).
  const mtf = new Uint8Array(256);
  for (let i = 0; i < 256; i++) mtf[i] = i;
  const byteCount = new Int32Array(256);
  let count = 0;
  let selIdx = 0;
  let groupLeft = 0;
  let lim = limit[0]!;
  let del = delta[0]!;
  let pm = perm[0]!;
  let minLen = 0;
  let runPos = 0;
  let runLen = 0;

  for (;;) {
    if (groupLeft === 0) {
      if (selIdx >= nSelectors) throw new Bzip2Error('ran out of selectors');
      const g = selectors[selIdx++]!;
      lim = limit[g]!;
      del = delta[g]!;
      pm = perm[g]!;
      minLen = minLens[g]!;
      groupLeft = GROUP_SIZE;
    }
    groupLeft--;

    let len = minLen;
    let code = br.bits(len);
    while (code > lim[len]!) {
      len++;
      if (len > MAX_CODE_LEN) throw new Bzip2Error('bad huffman code');
      code = (code << 1) | br.bit();
    }
    const sym = pm[code + del[len]!]!;

    if (sym <= 1) {
      // RUNA (0) adds runPos, RUNB (1) adds 2*runPos: bijective base-2 run length.
      if (runPos === 0) {
        runPos = 1;
        runLen = 0;
      }
      runLen += runPos << sym;
      runPos <<= 1;
      if (runLen > maxBlock) throw new Bzip2Error('run too long');
      continue;
    }

    if (runPos) {
      runPos = 0;
      if (count + runLen > maxBlock) throw new Bzip2Error('block overflow');
      const b = seqToUnseq[mtf[0]!]!;
      byteCount[b]! += runLen;
      tt.fill(b, count, count + runLen);
      count += runLen;
    }

    if (sym === eob) break;

    if (count >= maxBlock) throw new Bzip2Error('block overflow');
    const nn = sym - 1;
    const v = mtf[nn]!;
    mtf.copyWithin(1, 0, nn);
    mtf[0] = v;
    const b = seqToUnseq[v]!;
    byteCount[b]!++;
    tt[count++] = b;
  }

  if (origPtr >= count) throw new Bzip2Error('origPtr out of range');

  // Inverse BWT: build the T-vector in the upper 24 bits of tt.
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    const c = byteCount[i]!;
    byteCount[i] = sum;
    sum += c;
  }
  for (let i = 0; i < count; i++) {
    const b = tt[i]! & 0xff;
    tt[byteCount[b]!]! |= i << 8;
    byteCount[b]!++;
  }

  // Walk the T-vector, undoing RLE1 (4 equal bytes are followed by a repeat count).
  out.ensure(count + 1024);
  let pos = tt[origPtr]! >>> 8;
  let last = -1;
  let run = 0;
  for (let i = 0; i < count; i++) {
    const entry = tt[pos]!;
    const b = entry & 0xff;
    pos = entry >>> 8;
    if (run === 4) {
      out.ensure(b);
      out.buf.fill(last, out.len, out.len + b);
      out.len += b;
      run = 0;
      continue;
    }
    if (b === last) run++;
    else {
      run = 1;
      last = b;
    }
    out.ensure(1);
    out.buf[out.len++] = b;
  }
}
