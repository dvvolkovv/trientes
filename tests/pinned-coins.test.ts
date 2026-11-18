import { describe, it, expect } from "vitest";
import {
  insertPinned,
  changeFromPoints,
  sparklineFromPoints,
  type ListRow,
  type PinnedListRow,
} from "@/lib/pinned-coins";

function row(id: string, rank: number, cap = 1e9): ListRow {
  return {
    id,
    symbol: id.toUpperCase(),
    name: id,
    logoUrl: null,
    rank,
    priceUsd: 1,
    marketCapUsd: cap,
    volume24hUsd: 1,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    pctChange1h: null,
    pctChange24h: null,
    pctChange7d: null,
    sparkline7d: null,
  };
}

function pinned(id: string, position: number): PinnedListRow {
  return { ...row(id, 0, 0), marketCapUsd: null, unranked: true, position };
}

// Ranks на главной — места рейтинга CoinGecko, и они разрежены (1, 2, 4, 6, 7, 8, 10…).
const list: ListRow[] = [
  row("btc", 1), row("eth", 2), row("bnb", 4), row("xrp", 6),
  row("sol", 7), row("trx", 8), row("hype", 10), row("zec", 11),
];

describe("insertPinned", () => {
  it("ставит монету на названное место", () => {
    const out = insertPinned(list, [pinned("taler", 8)]);
    expect(out.map((r) => r.id)).toEqual([
      "btc", "eth", "bnb", "xrp", "sol", "trx", "hype", "taler", "zec",
    ]);
  });

  it("даёт ключ сортировки между соседями, чтобы место держалось при сортировке по рейтингу", () => {
    const out = insertPinned(list, [pinned("taler", 8)]);
    const tal = out.find((r) => r.id === "taler")!;
    expect(tal.rank).toBeGreaterThan(10);
    expect(tal.rank).toBeLessThan(11);
    const byRank = [...out].sort((a, b) => a.rank - b.rank);
    expect(byRank.map((r) => r.id)).toEqual(out.map((r) => r.id));
  });

  it("место за концом списка значит «в конец»", () => {
    const out = insertPinned(list.slice(0, 3), [pinned("taler", 8)]);
    expect(out.map((r) => r.id)).toEqual(["btc", "eth", "bnb", "taler"]);
    expect(out[3].rank).toBeGreaterThan(4);
  });

  it("первое место тоже считается", () => {
    const out = insertPinned(list, [pinned("taler", 1)]);
    expect(out[0].id).toBe("taler");
    expect(out[0].rank).toBeLessThan(1);
  });

  it("место считается по рейтингу, а не по порядку в массиве", () => {
    // Так список и приходит: два снимка склеены, и USDT с USDC лежат в хвосте.
    const scrambled = [...list, row("usdt", 3), row("usdc", 5)];
    const out = insertPinned(scrambled, [pinned("taler", 8)]);
    expect(out.map((r) => r.id)).toEqual([
      "btc", "eth", "usdt", "bnb", "usdc", "xrp", "sol", "taler", "trx", "hype", "zec",
    ]);
    const tal = out.find((r) => r.id === "taler")!;
    expect(tal.rank).toBeGreaterThan(7);
    expect(tal.rank).toBeLessThan(8);
  });

  it("монету, которая уже есть в списке, второй строкой не рисует", () => {
    const out = insertPinned(list, [pinned("trx", 8)]);
    expect(out.map((r) => r.id)).toEqual(list.map((r) => r.id));
  });

  it("пустой список отдаёт одну строку", () => {
    const out = insertPinned([], [pinned("taler", 8)]);
    expect(out.map((r) => r.id)).toEqual(["taler"]);
    expect(out[0].rank).toBe(1);
  });
});

const hour = 3600_000;
const now = new Date("2026-11-18T14:00:00Z");

describe("changeFromPoints", () => {
  const pts = (hours: number[], prices: number[]) =>
    hours.map((h, i) => ({ at: new Date(now.getTime() - h * hour), priceUsd: prices[i] }));

  it("считает суточное изменение от точки суточной давности", () => {
    const out = changeFromPoints(pts([0, 12, 24], [110, 105, 100]), now, 24);
    expect(out).toBeCloseTo(10, 6);
  });

  it("берёт ближайшую к сроку точку внутри допуска", () => {
    const out = changeFromPoints(pts([0, 22, 30], [110, 100, 50]), now, 24);
    expect(out).toBeCloseTo(10, 6);
  });

  it("без точки внутри допуска молчит, а не считает от чего попало", () => {
    expect(changeFromPoints(pts([0, 120], [110, 100]), now, 24)).toBeNull();
  });

  it("одна точка — изменения нет", () => {
    expect(changeFromPoints(pts([0], [110]), now, 24)).toBeNull();
  });

  it("устаревший ряд не выдаётся за сегодняшний", () => {
    expect(changeFromPoints(pts([30, 54], [110, 100]), now, 24)).toBeNull();
  });
});

describe("sparklineFromPoints", () => {
  it("отдаёт цены за неделю по возрастанию времени", () => {
    const points = [
      { at: new Date(now.getTime() - 2 * hour), priceUsd: 2 },
      { at: new Date(now.getTime() - 3 * hour), priceUsd: 1 },
      { at: new Date(now.getTime() - 1 * hour), priceUsd: 3 },
    ];
    expect(sparklineFromPoints(points, now)).toEqual([1, 2, 3]);
  });

  it("точки старше недели в линию не идут", () => {
    const points = [
      { at: new Date(now.getTime() - 9 * 24 * hour), priceUsd: 9 },
      { at: new Date(now.getTime() - 2 * hour), priceUsd: 2 },
      { at: new Date(now.getTime() - 1 * hour), priceUsd: 3 },
    ];
    expect(sparklineFromPoints(points, now)).toEqual([2, 3]);
  });

  it("одна точка линией не рисуется", () => {
    expect(sparklineFromPoints([{ at: now, priceUsd: 1 }], now)).toBeNull();
  });
});
