import { describe, expect, it } from "vitest";
import { fetchMarkets, marketFetchOrder, parseYahooChart, MARKET_INSTRUMENTS } from "@/lib/markets";

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

/**
 * Порядок обхода. Служба режет частоту: за прогон проходит одна-две котировки
 * из десяти, и отказ достаётся **началу** обхода. Поэтому очередь строится по
 * нашему собственному факту — когда мы об инструменте спрашивали, — а не по
 * штампу котировки: штамп принадлежит рынку (`regularMarketTime`), у закрытого
 * рынка он не двигается, и такой инструмент навсегда оставался самым ветхим,
 * навсегда стоял первым и навсегда получал 429. Живой случай 18 ноября:
 * платина и палладий не снялись ни разу за сутки, хотя служба их отдаёт.
 */
describe("marketFetchOrder", () => {
  const at = (k: number) => `2026-11-18T10:${String(k).padStart(2, "0")}:00.000Z`;

  it("ещё не спрошенные идут первыми, в порядке списка", () => {
    const order = marketFetchOrder({ "^DJI": at(0), "GC=F": at(0) });
    expect(order.map((i) => i.symbol).slice(0, 3)).toEqual(["^IXIC", "^GSPC", "ES=F"]);
    expect(order).toHaveLength(MARKET_INSTRUMENTS.length);
  });

  it("спрошенные раньше идут раньше спрошенных позже", () => {
    const asked = Object.fromEntries(MARKET_INSTRUMENTS.map((i, k) => [i.symbol, at(k)]));
    const order = marketFetchOrder(asked);
    expect(order[0].symbol).toBe("^DJI");
    expect(order[order.length - 1].symbol).toBe("PA=F");
  });

  it("отказ по частоте очередь двигает: спрошенный уходит в хвост", () => {
    const asked: Record<string, string> = {};
    const head = marketFetchOrder(asked).slice(0, 2).map((i) => i.symbol);
    expect(head).toEqual(["^DJI", "^IXIC"]);
    // Спросили и получили 429 — котировки нет, но спрос был, и он учтён.
    for (const symbol of head) asked[symbol] = at(0);
    const next = marketFetchOrder(asked);
    expect(next.slice(0, 2).map((i) => i.symbol)).toEqual(["^GSPC", "ES=F"]);
    expect(next.slice(-2).map((i) => i.symbol)).toEqual(head);
  });

  it("пустая карта спросов — порядок списка", () => {
    expect(marketFetchOrder({}).map((i) => i.symbol)).toEqual(MARKET_INSTRUMENTS.map((i) => i.symbol));
  });

  it("чужой символ в карте спросов обход не ломает", () => {
    const order = marketFetchOrder({ ".DJI": at(0) });
    expect(order).toHaveLength(MARKET_INSTRUMENTS.length);
  });
});

/**
 * Бюджет службы замерен 18 ноября: около одной котировки в полминуты, и от
 * паузы между запросами он не зависит. Значит прогон должен прекращаться, а не
 * доколачивать десять запросов в заведомые 429.
 */
describe("fetchMarkets", () => {
  const ok = (symbol: string) =>
    new Response(
      JSON.stringify({
        chart: { result: [{ meta: { symbol, regularMarketTime: 1795000825, regularMarketPrice: 1 } }], error: null },
      }),
      { status: 200 },
    );
  const throttled = () => new Response("Too Many Requests", { status: 429 });

  it("прекращает обход после трёх отказов по частоте подряд", async () => {
    const asked: string[] = [];
    const { quotes } = await fetchMarkets(MARKET_INSTRUMENTS, { gapMs: 0, fetchImpl: async (url) => {
      const symbol = decodeURIComponent(String(url).split("/chart/")[1].split("?")[0]);
      asked.push(symbol);
      return asked.length === 1 ? ok(symbol) : throttled();
    } });
    expect(quotes.map((q) => q.symbol)).toEqual(["^DJI"]);
    expect(asked).toHaveLength(4); // одна прошедшая и три отказа
  });

  it("прошедшая котировка счёт отказов обнуляет", async () => {
    const asked: string[] = [];
    const { quotes } = await fetchMarkets(MARKET_INSTRUMENTS.slice(0, 6), { gapMs: 0, fetchImpl: async (url) => {
      const symbol = decodeURIComponent(String(url).split("/chart/")[1].split("?")[0]);
      asked.push(symbol);
      return asked.length % 3 === 0 ? ok(symbol) : throttled();
    } });
    expect(asked).toHaveLength(6);
    expect(quotes).toHaveLength(2);
  });

  it("сообщает, о чём спросил: отказ по частоте — тоже спрос", async () => {
    // Иначе очередь не двигается: получивший 429 остаётся самым ветхим,
    // в следующем прогоне снова стоит первым и снова получает 429.
    const { quotes, asked } = await fetchMarkets(MARKET_INSTRUMENTS, { gapMs: 0, fetchImpl: async () => throttled() });
    expect(quotes).toEqual([]);
    expect(asked).toEqual(["^DJI", "^IXIC", "^GSPC"]);
  });

  it("отказ не по частоте обход не прекращает — он про инструмент, а не про бюджет", async () => {
    const asked: string[] = [];
    const { quotes } = await fetchMarkets(MARKET_INSTRUMENTS.slice(0, 5), { gapMs: 0, fetchImpl: async (url) => {
      const symbol = decodeURIComponent(String(url).split("/chart/")[1].split("?")[0]);
      asked.push(symbol);
      return symbol === "CL=F" ? ok(symbol) : new Response("Not Found", { status: 404 });
    } });
    expect(asked).toHaveLength(5);
    expect(quotes.map((q) => q.symbol)).toEqual(["CL=F"]);
  });
});
