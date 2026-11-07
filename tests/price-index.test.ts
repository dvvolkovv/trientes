import { describe, it, expect } from "vitest";
import {
  computeIndex,
  DUST_VOLUME_USD,
  weightedMedian,
  type IndexCandidate,
  type IndexResult,
} from "../src/lib/price-index";

const m = (id: string, priceUsd: number, volumeUsd24h: number, changePct: number | null = null): IndexCandidate =>
  ({ id, priceUsd, volumeUsd24h, changePct });

const ok = (r: ReturnType<typeof computeIndex>): IndexResult => {
  if ("error" in r) throw new Error(`ожидался индекс, получено ${r.error}`);
  return r;
};

describe("weightedMedian", () => {
  it("одна точка", () => {
    expect(weightedMedian([{ value: 5, weight: 100 }])).toBe(5);
  });

  it("при равных весах берёт середину по весу", () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 3, weight: 1 }])).toBe(1);
  });

  it("перевес в одну биржу притягивает медиану к ней", () => {
    const v = weightedMedian([
      { value: 1, weight: 1 },
      { value: 2, weight: 1 },
      { value: 10, weight: 1000 },
    ]);
    expect(v).toBe(10);
  });

  it("нулевые веса вырождаются в обычную медиану", () => {
    expect(weightedMedian([{ value: 1, weight: 0 }, { value: 3, weight: 0 }])).toBe(2);
    expect(weightedMedian([{ value: 1, weight: 0 }, { value: 3, weight: 0 }, { value: 4, weight: 0 }])).toBe(3);
  });

  it("пустой вход и мусор", () => {
    expect(weightedMedian([])).toBeNull();
    expect(weightedMedian([{ value: Number.NaN, weight: 1 }])).toBeNull();
  });

  it("считает и отрицательные значения — тем же кодом идёт change24h", () => {
    expect(weightedMedian([{ value: -7.5, weight: 100 }, { value: 40, weight: 1 }])).toBe(-7.5);
  });
});

describe("computeIndex", () => {
  it("без рынков индекса нет", () => {
    expect(computeIndex([])).toEqual({ error: "insufficient_markets" });
    expect(computeIndex([m("a", 0, 100)])).toEqual({ error: "insufficient_markets" });
  });

  it("считает цену, объём и разброс по подтверждённым рынкам", () => {
    const r = ok(computeIndex([
      m("a", 1.00, 500_000, 2),
      m("b", 1.02, 400_000, 3),
      m("c", 0.99, 300_000, 1),
    ]));
    expect(r.marketCount).toBe(3);
    expect(r.volumeUsd24h).toBe(1_200_000);
    expect(r.priceUsd).toBe(1.0);
    expect(r.spreadPct).toBeCloseTo(3, 6);
    expect(r.confidence).toBe("HIGH");
    expect(r.outlierIds).toEqual([]);
    expect(r.change24h).toBe(2);
  });

  it("отбрасывает пыль, но оставляет её видимой", () => {
    const r = ok(computeIndex([
      m("big", 1, 200_000),
      m("dust", 5, DUST_VOLUME_USD - 1),
    ]));
    expect(r.usedIds).toEqual(["big"]);
    expect(r.dustIds).toEqual(["dust"]);
    expect(r.priceUsd).toBe(1);
  });

  it("если вся монета — пыль, цена считается, но уверенность LOW", () => {
    const r = ok(computeIndex([m("a", 2, 100), m("b", 2.01, 90)]));
    expect(r.confidence).toBe("LOW");
    expect(r.marketCount).toBe(2);
    expect(r.dustIds).toEqual([]);
  });

  it("выброс выходит из расчёта", () => {
    const r = ok(computeIndex([
      m("a", 1.00, 100_000),
      m("b", 1.01, 100_000),
      m("fake", 3.00, 50_000),
    ]));
    expect(r.outlierIds).toEqual(["fake"]);
    expect(r.marketCount).toBe(2);
    expect(r.priceUsd).toBeLessThan(1.02);
  });

  it("медиана не переезжает к двум выбросам из трёх рынков", () => {
    // Два «дорогих» рынка с крошечным объёмом не перетягивают цену: вес решает.
    const r = ok(computeIndex([
      m("real", 1.00, 1_000_000),
      m("fake1", 1.60, 2_000),
      m("fake2", 1.62, 2_000),
    ]));
    expect(r.priceUsd).toBe(1.0);
    expect(r.outlierIds.sort()).toEqual(["fake1", "fake2"]);
  });

  it("один рынок — всегда LOW и без разброса", () => {
    const r = ok(computeIndex([m("a", 1, 5_000_000)]));
    expect(r.confidence).toBe("LOW");
    expect(r.spreadPct).toBeNull();
  });

  it("малый объём опускает уверенность", () => {
    expect(ok(computeIndex([m("a", 1, 4_000), m("b", 1.01, 4_000)])).confidence).toBe("LOW");
    expect(ok(computeIndex([m("a", 1, 30_000), m("b", 1.01, 30_000)])).confidence).toBe("MEDIUM");
  });

  it("изменение за сутки берётся по весу и переживает отрицательные значения", () => {
    const r = ok(computeIndex([
      m("a", 1, 1_000_000, -7.5),
      m("b", 1.01, 10_000, 40),
    ]));
    expect(r.change24h).toBeCloseTo(-7.5, 9);
  });

  it("без изменений от бирж change24h пустой", () => {
    expect(ok(computeIndex([m("a", 1, 200_000)])).change24h).toBeNull();
  });
});
