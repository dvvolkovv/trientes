import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Страница биржи зовёт подробности CoinPaprika **при отрисовке**, а служба
 * ограничена запасом месяца и 19 ноября его исчерпала: каждый ответ 402
 * повторялся через 10 и 30 секунд, страница отдавалась 50 секунд, обход
 * поисковика по двенадцати языкам разом догонял веб до 800 МБ, pm2 перезапускал
 * его по памяти, и все посетители получали 502.
 *
 * Отсюда две границы этого файла. Срок ожидания: у страницы уже есть числа из
 * базы со своим штампом времени, и ждать чужую службу дольше трёх секунд она не
 * должна (тот же срок, что у рельса пожертвований). И один запрос на одну
 * биржу: двенадцать языков одной страницы — это один вопрос, а не двенадцать.
 */
const mocks = vi.hoisted(() => ({
  redis: { get: vi.fn(), set: vi.fn() },
  prisma: {
    exchangeMarket: { upsert: vi.fn() },
    exchange: { update: vi.fn() },
  },
  fetchDetail: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: mocks.redis }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/coinpaprika", () => ({
  fetchCoinPaprikaExchangeDetail: mocks.fetchDetail,
}));

import { FRESH_DEADLINE_MS, getFreshExchangeDetail } from "@/lib/exchange-fresh";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.redis.get.mockResolvedValue(null);
  mocks.redis.set.mockResolvedValue("OK");
});

afterEach(() => {
  vi.useRealTimers();
});

const detail = {
  id: "binance",
  volume24hUsd: 1_000,
  currencies: 400,
  pairsCount: 1_500,
  markets: [],
};

describe("getFreshExchangeDetail", () => {
  it("отдаёт null по сроку, не дожидаясь чужой службы", async () => {
    mocks.fetchDetail.mockReturnValue(new Promise(() => {}));

    const pending = getFreshExchangeDetail("binance", "binance");
    await vi.advanceTimersByTimeAsync(FRESH_DEADLINE_MS + 1);

    await expect(pending).resolves.toBeNull();
    // Молчание запоминается: следующая отрисовка не должна ждать заново.
    expect(mocks.redis.set).toHaveBeenCalledWith("exch-fresh:binance", "", "EX", expect.any(Number));
  });

  it("успевший ответ отдаётся как есть", async () => {
    mocks.fetchDetail.mockResolvedValue(detail);

    const pending = getFreshExchangeDetail("binance", "binance");
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({
      cpId: "binance",
      volume24hUsd: 1_000,
      currencies: 400,
      pairsCount: 1_500,
    });
  });

  it("двенадцать языков одной страницы — один запрос в службу", async () => {
    let resolveDetail: (v: unknown) => void = () => {};
    mocks.fetchDetail.mockReturnValue(new Promise((r) => { resolveDetail = r; }));

    const all = Promise.all(
      Array.from({ length: 12 }, () => getFreshExchangeDetail("binance", "binance")),
    );
    await vi.advanceTimersByTimeAsync(1);
    resolveDetail(detail);
    const rows = await all;

    expect(mocks.fetchDetail).toHaveBeenCalledTimes(1);
    expect(rows.every((r) => r?.volume24hUsd === 1_000)).toBe(true);
  });

  it("следующий посетитель спрашивает снова — запрос не залипает", async () => {
    mocks.fetchDetail.mockResolvedValue(detail);

    const first = getFreshExchangeDetail("binance", "binance");
    await vi.advanceTimersByTimeAsync(1);
    await first;

    const second = getFreshExchangeDetail("binance", "binance");
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(mocks.fetchDetail).toHaveBeenCalledTimes(2);
  });

  it("сбой службы — это null и короткая запись о молчании, а не исключение", async () => {
    mocks.fetchDetail.mockRejectedValue(new Error("coinpaprika /exchanges/binance 402"));

    const pending = getFreshExchangeDetail("binance", "binance");
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeNull();
  });
});
