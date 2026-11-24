import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { alignmentPositions, dataCodewords, dataCodewordsOf, encodeQr, interleave, formatBits, MAX_VERSION, penalty, rawDataModules, rsDivisor, rsRemainder, versionBits, versionFor, type QrCode } from '@/lib/qr';
import vectors from './fixtures/qr-vectors.json';

// Whole symbols from Project Nayuki's reference encoder (byte mode, level M, versions 1–10, mask chosen by it,
// no boosting of the level): versions 1 to 10 and all eight masks among them. The same symbol, module for module,
// means the same data, error correction, layout and choice of mask. Made with its TypeScript
// (`QrCode.encodeSegments([QrSegment.makeBytes(bytes)], Ecc.MEDIUM, 1, 10, -1, false)`); its Python package qrcodegen
// 1.8.0 gives the same (`encode_segments([make_bytes(b)], Ecc.MEDIUM, 1, 10, -1, False)`).
describe('the reference encoder’s symbols, module for module', () => {
  for (const v of vectors as { text: string; version: number; mask: number; rows: string[] }[]) {
    it(`version ${v.version}, mask ${v.mask}: ${v.text.length} bytes`, () => {
      const q = encodeQr(v.text);
      expect([q.version, q.mask, q.size]).toEqual([v.version, v.mask, v.version * 4 + 17]);
      const rows = q.modules.map((r) => BigInt(`0b${r.map((d) => (d ? '1' : '0')).join('')}`).toString(16).padStart(v.rows[0]!.length, '0'));
      expect(rows).toEqual(v.rows);
    });
  }
  it('the vectors cover every version and every mask', () => {
    const vs = vectors as { version: number; mask: number }[];
    expect(new Set(vs.map((v) => v.version))).toEqual(new Set(Array.from({ length: MAX_VERSION }, (_, i) => i + 1)));
    expect(new Set(vs.map((v) => v.mask))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });
});

/** The symbol as an RGBA image with a 4-module quiet zone, `scale` pixels a module, as a camera would see it. */
function image(q: QrCode, scale = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const side = (q.size + 8) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < q.size; y++)
    for (let x = 0; x < q.size; x++) {
      if (!q.modules[y]![x]) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  return { data, width: side, height: side };
}

describe('an independent decoder reads every symbol back', () => {
  const links = [
    'bitcoin:tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7?amount=0.00123456',
    'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0015',
    'ethereum:0xB6e6763fdf76369eA68B7e9dD0930b07a93f3f6a@11155111?value=123456789012345678',
    'a',
    'Ёжик ✓', // UTF-8 bytes, not code points
  ];
  for (const text of links)
    it(text, () => {
      const q = encodeQr(text);
      const { data, width, height } = image(q);
      expect(jsQR(data, width, height)?.data).toBe(text);
    });
  it('the largest of every version', () => {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const bytes = Array.from({ length: 300 }, (_, i) => i).find((n) => versionFor(n + 1) !== v && versionFor(n) === v)!;
      const text = 'x'.repeat(bytes);
      const q = encodeQr(text);
      expect(q.version).toBe(v);
      const { data, width, height } = image(q);
      expect(jsQR(data, width, height)?.data).toBe(text);
    }
  });
});

describe('capacity at level M', () => {
  it('data codewords of the standard', () => {
    expect([1, 2, 5, 6, 7, 9, 10].map(dataCodewords)).toEqual([16, 28, 86, 108, 124, 182, 216]);
    expect([1, 2, 7].map(rawDataModules)).toEqual([208, 359, 1568]);
  });
  it('the smallest version that holds the bytes; the count field grows from 8 to 16 bits at version 10', () => {
    expect([1, 14, 15, 26, 106, 107, 180, 181, 213].map(versionFor)).toEqual([1, 1, 2, 2, 6, 7, 9, 10, 10]);
    expect(versionFor(214)).toBeNull();
  });
  it('more than version 10 holds is refused, not cut', () => {
    expect(() => encodeQr('x'.repeat(214))).toThrow(/214 bytes do not fit version 10/);
    expect(() => encodeQr('ж'.repeat(107))).toThrow(/214 bytes/);
  });
  it('nor cut at any step: data beyond its version, codewords of another version, a lone surrogate', () => {
    expect(() => dataCodewordsOf(new Uint8Array(15), 1)).toThrow(/15 bytes do not fit version 1/);
    expect(dataCodewordsOf(new Uint8Array(14), 1)).toHaveLength(16);
    expect(() => interleave(new Array<number>(15).fill(0), 1)).toThrow(/15 data codewords, version 1 takes 16/);
    expect(() => encodeQr('a\udc00')).toThrow(/lone surrogate/);
    expect(encodeQr('🙂').version).toBe(1); // a pair is one character
  });
});

describe('the parts', () => {
  it('format bits of level M, all eight masks (the standard’s table)', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((m) => formatBits(m).toString(2).padStart(15, '0'))).toEqual(table);
  });
  it('version bits 7–10 (the standard’s table)', () => {
    expect([7, 8, 9, 10].map(versionBits)).toEqual([0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
  });
  it('alignment pattern centres', () => {
    expect([1, 2, 6, 7, 10].map(alignmentPositions)).toEqual([[], [6, 18], [6, 34], [6, 22, 38], [6, 28, 50]]);
  });
  it('Reed–Solomon: the generator of degree 10 and the error correction of the standard’s example (version 1-M)', () => {
    expect(rsDivisor(10)).toEqual([216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
    // ISO/IEC 18004 annex I: "01234567" at 1-M
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });
  it('the penalty of a plain symbol: runs, blocks, balance', () => {
    const light = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false));
    // every row and column one run of 21 (3 + 16), 400 2×2 blocks (×3), all light: 50 % off balance (9 × 10)
    expect(penalty(light)).toBe(42 * 19 + 400 * 3 + 90);
  });
});
