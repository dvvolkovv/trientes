import { describe, expect, it } from "vitest";
import {
  dexPairKey,
  parseDexCandles,
  parseDexPairs,
  sumDexVolumeUsd,
  type DexCandle,
} from "../src/lib/dex-candles";

const PAIR = { key: "TAL-USDT", base: "TAL", quote: "USDT" };

/** Живой ответ службы заявок 11 ноября 2026 (сокращён до трёх свечей). */
const LIVE = {
  source: "trientes",
  symbol: "TAL/USDT",
  interval: "1h",
  fetchedAt: 1794432425323,
  asOf: { block: 507732, time: 1794432408001 },
  ageS: 17,
  candles: [
    { time: 1794243600, open: 12114.36, high: 12115.44, low: 12109.5, close: 12110.58, volume: 0 },
    { time: 1794247200, open: 12110.58, high: 12115.98, low: 12109.5, close: 12112.74, volume: 0 },
    { time: 1794250800, open: 12112.74, high: 12133.26, low: 12112.2, close: 12132.18, volume: 0.004 },
  ],
};

describe("dexPairKey", () => {
  it("пара карточки становится путём службы", () => {
    expect(dexPairKey("TAL/USDT")).toBe("TAL-USDT");
    expect(dexPairKey("tal/usdt")).toBe("TAL-USDT");
  });

  it("не пара — не путь", () => {
    expect(dexPairKey("TAL")).toBeNull();
    expect(dexPairKey("TAL/USDT/EXTRA")).toBeNull();
    expect(dexPairKey("../../etc")).toBeNull();
    expect(dexPairKey(null)).toBeNull();
  });
});

describe("parseDexPairs", () => {
  it("читает список пар службы", () => {
    expect(
      parseDexPairs({
        pairs: [
          { key: "TAL-USDT", base: "TAL", quote: "USDT" },
          { key: "TAL-USDC", base: "TAL", quote: "USDC" },
        ],
      }),
    ).toHaveLength(2);
  });

  it("строка, не сходящаяся сама с собой, отбрасывается", () => {
    expect(parseDexPairs({ pairs: [{ key: "BTC-USDT", base: "TAL", quote: "USDT" }] })).toEqual([]);
  });
});

describe("parseDexCandles", () => {
  it("читает живой ответ и запоминает блок", () => {
    const got = parseDexCandles(LIVE, { pair: PAIR, interval: "1h" });
    expect(got?.candles).toHaveLength(3);
    expect(got?.block).toBe(507732);
    expect(got?.candles[2].close).toBe(12132.18);
  });

  // Ответ не про ту пару или не про тот шаг — чужой ряд: нарисованный, он
  // читался бы как ряд этой монеты.
  it("чужая пара и чужой шаг отвергаются", () => {
    expect(parseDexCandles(LIVE, { pair: { ...PAIR, base: "BTC" }, interval: "1h" })).toBeNull();
    expect(parseDexCandles(LIVE, { pair: PAIR, interval: "4h" })).toBeNull();
    expect(parseDexCandles({ ...LIVE, source: "binance" }, { pair: PAIR, interval: "1h" })).toBeNull();
  });

  it("кривая свеча отменяет весь ряд, а не одну строку", () => {
    const broken = {
      ...LIVE,
      candles: [...LIVE.candles, { time: 1794254400, open: 1, high: 0.5, low: 2, close: 1, volume: 0 }],
    };
    expect(parseDexCandles(broken, { pair: PAIR, interval: "1h" })).toBeNull();
  });

  it("время должно идти вперёд", () => {
    const back = { ...LIVE, candles: [LIVE.candles[1], LIVE.candles[0]] };
    expect(parseDexCandles(back, { pair: PAIR, interval: "1h" })).toBeNull();
  });

  it("нулевая цена — не цена", () => {
    const zero = { ...LIVE, candles: [{ ...LIVE.candles[0], close: 0 }] };
    expect(parseDexCandles(zero, { pair: PAIR, interval: "1h" })).toBeNull();
  });
});

describe("sumDexVolumeUsd", () => {
  const NOW = new Date("2026-11-12T12:00:00.000Z");
  const hour = 3600;
  const t = (hoursAgo: number) => Math.floor(NOW.getTime() / 1000) - hoursAgo * hour;
  const candle = (hoursAgo: number, volume: number, close: number): DexCandle => ({
    time: t(hoursAgo),
    open: close,
    high: close,
    low: close,
    close,
    volume,
  });

  it("считает объём в долларах по цене закрытия каждой свечи", () => {
    const sum = sumDexVolumeUsd([candle(2, 0.01, 12_000), candle(1, 0.02, 10_000)], NOW);
    expect(sum).toBeCloseTo(0.01 * 12_000 + 0.02 * 10_000, 6);
  });

  it("свечи старше суток в окно не входят", () => {
    const sum = sumDexVolumeUsd([candle(30, 5, 12_000), candle(1, 0.02, 10_000)], NOW);
    expect(sum).toBeCloseTo(200, 6);
  });

  it("сделок не было — это ноль, а не отсутствие числа", () => {
    expect(sumDexVolumeUsd([candle(1, 0, 12_000)], NOW)).toBe(0);
  });

  it("ряда нет — объём неизвестен, и ноль тут соврал бы", () => {
    expect(sumDexVolumeUsd([], NOW)).toBeNull();
  });
});
