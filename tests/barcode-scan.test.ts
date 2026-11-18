import { describe, it, expect } from "vitest";
import { scanFrame } from "@/lib/barcode/scan";
import { drawSymbol, encodeEan13 } from "./fixtures/ean-symbol";

const CODE = "5449000000996";
const BITS = encodeEan13(CODE);

describe("scanFrame", () => {
  it("reads a symbol standing in the middle of the frame", () => {
    expect(scanFrame(drawSymbol(BITS))).toBe(CODE);
  });

  it("reads a mirrored symbol — the phone is held the other way round", () => {
    expect(scanFrame(drawSymbol(BITS, { mirrored: true }))).toBe(CODE);
  });

  it("reads a symbol lying across the frame — the phone is turned 90°", () => {
    expect(scanFrame(drawSymbol(BITS, { vertical: true }))).toBe(CODE);
  });

  it("reads a symbol in a narrow band near the top edge", () => {
    expect(scanFrame(drawSymbol(BITS, { top: 0.04, bottom: 0.18 }))).toBe(CODE);
  });

  it("reads through camera noise", () => {
    expect(scanFrame(drawSymbol(BITS, { noise: 35 }))).toBe(CODE);
  });

  it("reads a dim shot: dark grey bars on light grey paper", () => {
    expect(scanFrame(drawSymbol(BITS, { dark: 90, light: 180 }))).toBe(CODE);
  });

  it("says nothing about an empty frame", () => {
    expect(scanFrame(drawSymbol("0", { moduleWidth: 1 }))).toBeNull();
  });

  it("says nothing when the frame has no contrast — a guess here lands in a passport", () => {
    expect(scanFrame(drawSymbol(BITS, { dark: 120, light: 140 }))).toBeNull();
  });
});
