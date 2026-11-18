import { describe, it, expect } from "vitest";
import { decodeEan } from "@/lib/barcode/ean";
import { bitsToRuns, encodeEan13, encodeEan8 } from "./fixtures/ean-symbol";

describe("decodeEan", () => {
  it("reads a real EAN-13 (Coca-Cola)", () => {
    const { runs, firstIsDark } = bitsToRuns(encodeEan13("5449000000996"), 3);
    expect(decodeEan(runs, firstIsDark)).toBe("5449000000996");
  });

  it("reads every first digit, because the leading one is spelled by parity alone", () => {
    for (const code of [
      "0012345678905",
      "1234567890128",
      "2000000000008",
      "3046920029759",
      "4006381333931",
      "5000112637939",
      "6001087357005",
      "7613034626844",
      "8712345678906",
      "9780201379624",
    ]) {
      const { runs, firstIsDark } = bitsToRuns(encodeEan13(code), 4);
      expect(decodeEan(runs, firstIsDark), code).toBe(code);
    }
  });

  it("survives jittered run widths — a camera never measures whole modules", () => {
    const { runs, firstIsDark } = bitsToRuns(encodeEan13("4006381333931"), 4, 0.9);
    expect(decodeEan(runs, firstIsDark)).toBe("4006381333931");
  });

  it("reads a symbol surrounded by quiet zone and neighbouring clutter", () => {
    const { runs, firstIsDark } = bitsToRuns(`0101100${encodeEan13("5449000000996")}0001100`, 3);
    expect(decodeEan(runs, firstIsDark)).toBe("5449000000996");
  });

  it("reads EAN-8", () => {
    const { runs, firstIsDark } = bitsToRuns(encodeEan8("96385074"), 4);
    expect(decodeEan(runs, firstIsDark)).toBe("96385074");
  });

  it("keeps the leading zero of a UPC-A so one product keeps one passport", () => {
    const { runs, firstIsDark } = bitsToRuns(encodeEan13("0036000291452"), 4);
    expect(decodeEan(runs, firstIsDark)).toBe("0036000291452");
  });

  it("refuses a symbol whose check digit does not add up", () => {
    // Печатаем заведомо негодный код: читатель обязан молчать, а не выдать его.
    const { runs, firstIsDark } = bitsToRuns(encodeEan13("5449000000997"), 3);
    expect(decodeEan(runs, firstIsDark)).toBeNull();
  });

  it("refuses noise", () => {
    const runs = [5, 2, 9, 1, 3, 7, 2, 2, 8, 1, 4, 4, 6, 2, 2, 9, 1, 1, 5, 3, 7, 2, 2, 6, 3, 1, 9, 2, 4, 5, 1, 8, 2, 2, 7, 3, 1, 6, 4, 2, 9, 1, 3, 5, 2, 7, 2, 8, 1, 4, 6, 2, 3, 9, 1, 5, 2, 7, 3, 2];
    expect(decodeEan(runs, true)).toBeNull();
  });

  it("refuses a truncated symbol — half a code is not a code", () => {
    const { runs, firstIsDark } = bitsToRuns(encodeEan13("5449000000996"), 3);
    expect(decodeEan(runs.slice(0, 40), firstIsDark)).toBeNull();
  });
});
