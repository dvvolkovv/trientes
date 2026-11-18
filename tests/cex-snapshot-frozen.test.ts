import { describe, expect, it } from "vitest";
import { dropFrozen, STALE_TICKER_MS } from "../src/lib/cex-snapshot";
import type { Ticker, TickerMap } from "../src/lib/cex-registry";

/**
 * Снятая с торгов пара остаётся в снимке тикеров навсегда: Binance отдаёт её
 * последнее состояние, а окно «за 24 часа» у неё закрылось в день снятия.
 * Живой случай 18 ноября: ACA/USDT показывал 0,0018 $ при настоящей цене
 * 0,000158 — окно закрылось пятью днями раньше (closeTime 13 ноября), объём
 * 371 тыс. и 4001 сделка относились к тому же дню. Опорная цена такую пару
 * отвергала только потому, что расхождение было одиннадцатикратным; замри она
 * ближе к настоящей цене — и снимок выдал бы её за сегодняшнюю.
 */
const t = (nativeSymbol: string, closedAt: number | null): Ticker => ({
  nativeSymbol,
  price: 1,
  quoteVolume: 1,
  changePct: null,
  closedAt,
});
const mapOf = (...rows: Ticker[]): TickerMap => new Map(rows.map((r) => [r.nativeSymbol, r]));

describe("dropFrozen", () => {
  const now = 1795002028549;

  it("выбрасывает пару, у которой окно закрылось давно", () => {
    const m = dropFrozen(mapOf(t("LIVE", now - 1000), t("DEAD", now - 5 * 24 * 3600_000)), now);
    expect([...m.keys()]).toEqual(["LIVE"]);
  });

  it("пару без штампа оставляет: биржа его не отдаёт, а не замерла", () => {
    const m = dropFrozen(mapOf(t("NOSTAMP", null)), now);
    expect([...m.keys()]).toEqual(["NOSTAMP"]);
  });

  it("окно на границе допуска ещё живое", () => {
    const m = dropFrozen(mapOf(t("EDGE", now - STALE_TICKER_MS + 1000)), now);
    expect([...m.keys()]).toEqual(["EDGE"]);
  });

  it("штамп из будущего парой не считается негодной: часы биржи могут спешить", () => {
    const m = dropFrozen(mapOf(t("AHEAD", now + 60_000)), now);
    expect([...m.keys()]).toEqual(["AHEAD"]);
  });
});
