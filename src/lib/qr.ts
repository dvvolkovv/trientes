// QR codes of deposit links (BIP21, EIP-681), drawn on the page by this code alone: a QR library is code that
// decides which address a phone reads, and a wrong one would send the money elsewhere while the text beside it
// stays right. ISO/IEC 18004 in byte mode, error correction level M (15 % of the symbol may be lost), versions
// 1–10: up to 213 bytes — a deposit link is under 120. The steps follow Project Nayuki's reference encoder
// (https://www.nayuki.io/page/qr-code-generator-library): data bits, Reed–Solomon blocks interleaved,
// function patterns, the zigzag of codewords, and of the eight masks the one with the lowest penalty. The tests
// compare whole symbols with that encoder's, module for module, and read symbols back with an independent decoder.
// What does not fit is refused at every step, never cut: a symbol of part of a link is a link to somewhere else.

/** Versions this encoder makes: 21×21 to 57×57 modules. */
export const MAX_VERSION = 10;

// Level M, per version 1…10 (index 0 unused): error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M in the format information. */
const FORMAT_M = 0;

export interface QrCode {
  version: number;
  /** Modules a side: 17 + 4 × version. */
  size: number;
  /** The mask applied, 0…7. */
  mask: number;
  /** Dark modules: `modules[y][x]`. */
  modules: boolean[][];
}

/** Modules of the symbol that carry data and error correction, in bits (function patterns excluded). */
export function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** Data codewords of a version at level M. */
export function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version]! * BLOCKS[version]!;
}

/** The smallest version that holds `bytes` bytes in byte mode at level M; null — none up to MAX_VERSION. */
export function versionFor(bytes: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + 8 * bytes <= dataCodewords(v) * 8) return v;
  }
  return null;
}

// ── Reed–Solomon over GF(2⁸) modulo x⁸ + x⁴ + x³ + x² + 1 (0x11D)
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of `degree`, highest coefficient (always 1) left out. */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j] ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The error correction codewords of `data`. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

/** Data codewords of `bytes` in byte mode, terminated and padded to the version's capacity. */
export function dataCodewordsOf(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  const countBits = version <= 9 ? 8 : 16;
  const capacity = dataCodewords(version) * 8;
  if (4 + countBits + 8 * bytes.length > capacity) throw new Error(`QR: ${bytes.length} bytes do not fit version ${version}`);
  put(0b0100, 4); // byte mode
  put(bytes.length, countBits);
  for (const b of bytes) put(b, 8);
  // the terminator (up to four zero bits) and the zeros up to a whole byte are one and the same here: the header
  // is 12 or 20 bits, so the data ends four bits short of a byte, and versionFor left at least those four free
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Data split into blocks, each with its error correction, interleaved as the symbol carries them. */
export function interleave(data: readonly number[], version: number): number[] {
  if (data.length !== dataCodewords(version)) throw new Error(`QR: ${data.length} data codewords, version ${version} takes ${dataCodewords(version)}`);
  const blocks = BLOCKS[version]!;
  const eccLen = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks); // codewords of a short block, error correction included
  const divisor = rsDivisor(eccLen);
  const split: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    // a short block has one data codeword fewer: a gap keeps the columns of all blocks aligned
    split.push(i < shortBlocks ? [...dat, -1, ...ecc] : [...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (let j = 0; j < blocks; j++) if (i !== shortLen - eccLen || j >= shortBlocks) out.push(split[j]![i]!);
  return out;
}

/** Positions of the alignment patterns' centres on each axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = version * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The 15 format bits of level M and `mask`, BCH-coded and masked with 0x5412. */
export function formatBits(mask: number): number {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up), BCH-coded. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, dark: boolean) {
    this.dark[y]![x] = dark;
    this.fixed[y]![x] = true;
  }

  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0); // timing patterns
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(s - 4, 3);
    this.finder(3, s - 4);
    const align = alignmentPositions(this.version);
    const last = align.length - 1;
    for (let i = 0; i <= last; i++)
      for (let j = 0; j <= last; j++) if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) this.alignment(align[i]!, align[j]!);
    this.drawFormat(0); // reserved now, drawn for real with the mask
    this.drawVersion();
  }

  /** A finder pattern centred at (x, y), with its light separator. */
  finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, d !== 2 && d !== 4);
      }
  }

  alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(mask: number) {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true); // the dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  /** Codewords into the modules left free, in the zigzag of two-module columns from the bottom right. */
  drawCodewords(codewords: readonly number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // the vertical timing pattern
      for (let vert = 0; vert < this.size; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (this.fixed[y]![x] || i >= codewords.length * 8) continue;
          this.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
    }
    if (i !== codewords.length * 8) throw new Error(`QR: ${codewords.length * 8 - i} bits had no module`);
  }

  /** XOR the mask into the data modules; applied twice, it undoes itself. */
  applyMask(mask: number) {
    const m = MASKS[mask]!;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fixed[y]![x] && m(x, y)) this.dark[y]![x] = !this.dark[y]![x];
  }
}

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** The penalty of a finished symbol (ISO/IEC 18004, 7.8.3), scored as the reference encoder scores it. */
export function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  let result = 0;
  const line = (get: (i: number) => boolean) => {
    let color = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (get(i) === color) {
        run++;
        if (run === 5) result += N1;
        else if (run > 5) result++;
      } else {
        addHistory(run, history, size);
        if (!color) result += countFinderLike(history) * N3;
        color = get(i);
        run = 1;
      }
    }
    result += terminate(color, run, history, size) * N3;
  };
  for (let y = 0; y < size; y++) line((x) => dark[y]![x]!);
  for (let x = 0; x < size; x++) line((y) => dark[y]![x]!);
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = dark[y]![x];
      if (c === dark[y]![x + 1] && c === dark[y + 1]![x] && c === dark[y + 1]![x + 1]) result += N2;
    }
  let darkCount = 0;
  for (const row of dark) for (const d of row) if (d) darkCount++;
  const total = size * size;
  const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
  return result + k * N4;
}

// Runs of a line, newest first; the light border around the symbol counts as one run of its width.
function addHistory(run: number, history: number[], size: number) {
  if (history[0] === 0) run += size;
  history.pop();
  history.unshift(run);
}

// 1:1:3:1:1 dark runs with four light modules on one side at least.
function countFinderLike(h: readonly number[]): number {
  const n = h[1]!;
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0]! >= n * 4 && h[6]! >= n ? 1 : 0) + (core && h[6]! >= n * 4 && h[0]! >= n ? 1 : 0);
}

function terminate(color: boolean, run: number, history: number[], size: number): number {
  if (color) {
    addHistory(run, history, size);
    run = 0;
  }
  run += size; // the light border after the line
  addHistory(run, history, size);
  return countFinderLike(history);
}

/** The QR code of `text` (UTF-8, byte mode, level M), the smallest version that holds it. */
export function encodeQr(text: string): QrCode {
  // a lone surrogate is no character: TextEncoder would put U+FFFD in its place, and the symbol would carry another text
  if (/\p{Cs}/u.test(text)) throw new Error('QR: a lone surrogate in the text');
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) throw new Error(`QR: ${bytes.length} bytes do not fit version ${MAX_VERSION} at level M`);
  const sym = new Grid(version);
  sym.drawFunctionPatterns();
  sym.drawCodewords(interleave(dataCodewordsOf(bytes, version), version));
  let best = -1;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    sym.applyMask(mask);
    sym.drawFormat(mask);
    const p = penalty(sym.dark);
    if (p < bestPenalty) {
      best = mask;
      bestPenalty = p;
    }
    sym.applyMask(mask);
  }
  sym.applyMask(best);
  sym.drawFormat(best);
  return { version, size: sym.size, mask: best, modules: sym.dark.map((row) => [...row]) };
}
