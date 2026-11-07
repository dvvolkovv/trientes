import { describe, it, expect } from "vitest";
import { parsePair } from "../src/lib/pair";

describe("parsePair", () => {
  it("разбирает основные разделители", () => {
    for (const raw of ["TAL/USDT", "tal-usdt", "TAL_USDT", "TAL:USDT", " tal / usdt "]) {
      expect(parsePair(raw)).toEqual({ base: "TAL", quote: "USDT" });
    }
  });

  it("разбирает склеенную форму по известной котировке", () => {
    expect(parsePair("TALUSDT")).toEqual({ base: "TAL", quote: "USDT" });
    expect(parsePair("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
  });

  it("предпочитает длинную котировку короткой", () => {
    // «TALUSDC» — это TAL/USDC, а не TALUSD/C и не TALU/SDC.
    expect(parsePair("TALUSDC")).toEqual({ base: "TAL", quote: "USDC" });
    expect(parsePair("TALFDUSD")).toEqual({ base: "TAL", quote: "FDUSD" });
  });

  it("отказывается от неразбираемого", () => {
    expect(parsePair("")).toBeNull();
    expect(parsePair(null)).toBeNull();
    expect(parsePair("TALXYZ")).toBeNull();
    expect(parsePair("USDT")).toBeNull(); // одна только котировка — не пара
    expect(parsePair("BTC/USDT/PERP")).toBeNull();
    expect(parsePair("TAL/")).toBeNull();
  });
});
