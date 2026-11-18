import { describe, expect, it } from "vitest";
import { parseYahooChart, MARKET_INSTRUMENTS } from "@/lib/markets";

/**
 * Форма тела скопирована с живого ответа Yahoo (`/v8/finance/chart/<symbol>`),
 * урезана до полей, которые читает отображение.
 *
 * Прежний источник (CNBC) с 16 ноября 2026 отвечает нашему серверу 403 на любой
 * запрос — с браузерным UA, с referer и без. Табло 34 часа показывало прошлый
 * снимок. Yahoo прежде наш адрес тоже не пускал, но после переезда на DO он
 * отвечает, и это проверено живым запросом по всем десяти инструментам.
 */
function body(meta: Record<string, unknown>, quote?: Record<string, unknown>): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          meta,
          indicators: quote ? { quote: [quote] } : undefined,
        },
      ],
      error: null,
    },
  });
}

const GOLD = {
  symbol: "GC=F",
  regularMarketTime: 1794994578, // 2026-11-18T09:36:18Z
  regularMarketPrice: 3783.2,
  regularMarketChangePercent: -2.096,
  regularMarketDayHigh: 3859.3,
  regularMarketDayLow: 3759.5,
  chartPreviousClose: 3864.2,
};

describe("parseYahooChart", () => {
  it("кладёт ответ на свой инструмент и берёт открытие из свечи", () => {
    const q = parseYahooChart("GC=F", body(GOLD, { open: [3850.1] }));
    expect(q).toEqual({
      symbol: "GC=F",
      name: "gold",
      group: "metal",
      unit: "usd",
      date: "2026-11-18",
      time: "09:36:18",
      open: 3850.1,
      high: 3859.3,
      low: 3759.5,
      last: 3783.2,
      changePct: -2.096,
    });
  });

  it("считает ход сессии от прошлого закрытия, когда узел его не назвал", () => {
    const { regularMarketChangePercent: _drop, ...rest } = GOLD;
    const q = parseYahooChart("GC=F", body(rest));
    // (3783.2 − 3864.2) / 3864.2 × 100
    expect(q?.changePct).toBeCloseTo(-2.096, 3);
  });

  it("без цены котировки нет — пустая карточка хуже отсутствующей", () => {
    const { regularMarketPrice: _drop, ...rest } = GOLD;
    expect(parseYahooChart("GC=F", body(rest))).toBeNull();
  });

  it("незнакомый символ не превращается в котировку", () => {
    expect(parseYahooChart("ZZZ=F", body({ ...GOLD, symbol: "ZZZ=F" }))).toBeNull();
  });

  it("ошибка узла и мусор в теле дают null, а не бросок", () => {
    expect(parseYahooChart("GC=F", JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }))).toBeNull();
    expect(parseYahooChart("GC=F", "<html>Access Denied</html>")).toBeNull();
  });

  it("у всех инструментов символ в записи Yahoo", () => {
    for (const i of MARKET_INSTRUMENTS) {
      expect(i.symbol).toMatch(/^(\^[A-Z]+|[A-Z]+=F)$/);
    }
    expect(MARKET_INSTRUMENTS).toHaveLength(10);
  });
});
