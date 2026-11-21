import { describe, expect, it } from "vitest";
import {
  fetchMarkets,
  isMarketSymbol,
  marketFetchOrder,
  parseFredCsv,
  parseMetalPrice,
  parseNasdaqDate,
  parseNasdaqQuote,
  stalestQuote,
  stalestQuoteAt,
  MARKET_INSTRUMENTS,
} from "@/lib/markets";

/**
 * Табло читается тремя открытыми источниками: по одному на то, что он
 * действительно отдаёт. Один источник на всё (Yahoo до 21 ноября 2026) означал
 * узкое место: его бюджет для нашего адреса — около одной котировки в
 * полминуты, а 21 ноября он отвечал нашему адресу 429 **на всё**, и его три
 * карточки простояли ветхими восемнадцать часов. Карточку, которую нечем
 * наполнить, с табло снимают: фьючерса на S&P больше нет, нефть и газ читаются
 * спотовыми рядами FRED.
 *
 * Разбор ответа каждой службы — чистая функция и проверяется тестом, а не
 * живым запросом: именно здесь источник данных и ломается.
 */

// ——— FRED: дневные закрытия индексов, официальный ряд ———

describe("parseFredCsv", () => {
  const csv = [
    "observation_date,DJIA",
    "2026-11-17,50011.11",
    "2026-11-18,50198.17",
    "2026-11-19,49097.06",
    "2026-11-20,48147.33",
  ].join("\n");

  it("берёт последнее закрытие и ход дня по двум последним точкам ряда", () => {
    const q = parseFredCsv("DJI", csv);
    expect(q?.last).toBe(48147.33);
    expect(q?.date).toBe("2026-11-20");
    // Живая сверка 21 ноября: тот же ход, что отдавал прежний источник, −1,934 %.
    expect(q?.changePct).toBeCloseTo(-1.934, 3);
    // Ни времени, ни размаха дня ряд не содержит, и подставлять их нечем.
    expect(q?.time).toBeNull();
    expect(q?.high).toBeNull();
    expect(q?.low).toBeNull();
    expect(q?.open).toBeNull();
  });

  it("пропуск в ряду читается как пропуск, а не как нуль", () => {
    // Выходной день у FRED обозначен точкой. Ноль означал бы падение индекса
    // в нуль и перевернул бы ход дня.
    const q = parseFredCsv("DJI", ["observation_date,DJIA", "2026-11-19,49097.06", "2026-11-20,."].join("\n"));
    expect(q?.last).toBe(49097.06);
    expect(q?.date).toBe("2026-11-19");
    expect(q?.changePct).toBeNull();
  });

  it("чужой ряд в заголовке — не наша карточка", () => {
    expect(parseFredCsv("DJI", ["observation_date,SP500", "2026-11-20,7175.83"].join("\n"))).toBeNull();
  });

  it("одна точка даёт цену без хода дня", () => {
    const q = parseFredCsv("GSPC", ["observation_date,SP500", "2026-11-20,7175.83"].join("\n"));
    expect(q?.last).toBe(7175.83);
    expect(q?.changePct).toBeNull();
  });

  it("пустое тело и страница с ошибкой дают null", () => {
    expect(parseFredCsv("DJI", "")).toBeNull();
    expect(parseFredCsv("DJI", "<html>Service Unavailable</html>")).toBeNull();
  });

  it("ряд FRED на ключ чужого источника не кладётся", () => {
    expect(parseFredCsv("XAU", csv)).toBeNull();
  });
});

// ——— api.nasdaq.com: Nasdaq Composite от владельца индекса ———

describe("parseNasdaqQuote", () => {
  const body = JSON.stringify({
    data: {
      symbol: "COMP",
      companyName: "NASDAQ Composite Index",
      primaryData: {
        lastSalePrice: "22,617.73",
        netChange: "-1,261.47",
        percentageChange: "-5.28%",
        lastTradeTimestamp: "Nov 20, 2026",
      },
      keyStats: {
        previousclose: { label: "Previous Close:", value: "23,879.20" },
        dayrange: { label: "Day Range:", value: "22,513.01 - 23,837.76" },
      },
      marketStatus: "Closed",
    },
    status: { rCode: 200 },
  });

  it("читает цену, ход дня и размах", () => {
    const q = parseNasdaqQuote("IXIC", body);
    expect(q?.last).toBe(22617.73);
    expect(q?.changePct).toBeCloseTo(-5.28, 2);
    expect(q?.low).toBe(22513.01);
    expect(q?.high).toBe(23837.76);
    expect(q?.date).toBe("2026-11-20");
    expect(q?.source).toBe("nasdaq");
  });

  it("считает ход от прошлого закрытия, если процента в ответе нет", () => {
    const stripped = JSON.parse(body);
    delete stripped.data.primaryData.percentageChange;
    const q = parseNasdaqQuote("IXIC", JSON.stringify(stripped));
    expect(q?.changePct).toBeCloseTo(((22617.73 - 23879.2) / 23879.2) * 100, 6);
  });

  it("незнакомый службе символ — её обычный ответ с пустым data", () => {
    // Живой случай: SPX и DJI она не знает и отвечает 200 с rCode 400 в теле.
    expect(parseNasdaqQuote("IXIC", JSON.stringify({ data: null, status: { rCode: 400 } }))).toBeNull();
  });

  it("ответ про чужой индекс на нашу карточку не кладётся", () => {
    const other = JSON.parse(body);
    other.data.symbol = "NDX";
    expect(parseNasdaqQuote("IXIC", JSON.stringify(other))).toBeNull();
  });
});

describe("parseNasdaqDate", () => {
  it("читает дату закрытия", () => {
    expect(parseNasdaqDate("Nov 20, 2026")).toBe("2026-11-20");
    expect(parseNasdaqDate("Jan 5, 2027")).toBe("2027-01-05");
  });

  it("часы восточного времени отбрасывает — под подписью UTC они соврали бы", () => {
    expect(parseNasdaqDate("Nov 21, 2026 4:15 PM ET")).toBe("2026-11-21");
  });

  it("мусор и пустое дают null", () => {
    expect(parseNasdaqDate("")).toBeNull();
    expect(parseNasdaqDate("Foo 20, 2026")).toBeNull();
    expect(parseNasdaqDate(undefined)).toBeNull();
  });
});

// ——— api.gold-api.com: спотовая цена металла ———

describe("parseMetalPrice", () => {
  const body = JSON.stringify({
    currency: "USD",
    currencySymbol: "$",
    exchangeRate: 1,
    name: "Gold",
    price: 3539.0,
    symbol: "XAU",
    updatedAt: "2026-11-21T07:21:37Z",
  });

  it("читает цену и штамп службы", () => {
    const q = parseMetalPrice("XAU", body);
    expect(q?.last).toBe(3539);
    expect(q?.date).toBe("2026-11-21");
    expect(q?.time).toBe("07:21:37");
    expect(q?.name).toBe("gold");
    expect(q?.group).toBe("metal");
  });

  it("хода за день не выдумывает: служба его не сообщает", () => {
    // Посчитать его можно было бы только по нашему прежнему снимку — то есть
    // выдать своё вычисление за факт источника.
    expect(parseMetalPrice("XAU", body)?.changePct).toBeNull();
  });

  it("цена не в долларах под подписью «$» не идёт", () => {
    const eur = JSON.parse(body);
    eur.currency = "EUR";
    expect(parseMetalPrice("XAU", JSON.stringify(eur))).toBeNull();
  });

  it("ответ про другой металл на нашу карточку не кладётся", () => {
    const silver = JSON.parse(body);
    silver.symbol = "XAG";
    expect(parseMetalPrice("XAU", JSON.stringify(silver))).toBeNull();
  });

  it("нулевая и отсутствующая цена дают null", () => {
    const zero = JSON.parse(body);
    zero.price = 0;
    expect(parseMetalPrice("XAU", JSON.stringify(zero))).toBeNull();
    const none = JSON.parse(body);
    delete none.price;
    expect(parseMetalPrice("XAU", JSON.stringify(none))).toBeNull();
  });
});

describe("реестр инструментов", () => {
  it("девять карточек, ключи свои и неповторимые", () => {
    expect(MARKET_INSTRUMENTS).toHaveLength(9);
    const keys = MARKET_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(keys).size).toBe(keys.length);
    // Ключ — наш, а не записи чужой службы: «^DJI», «GC=F» и «CL=F» были
    // записью Yahoo, и после переезда источников они стали бы ложью внутри
    // наших же данных.
    for (const k of keys) {
      expect(k.startsWith("^")).toBe(false);
      expect(k).not.toContain("=");
    }
  });

  it("у каждой карточки один источник и его название инструмента", () => {
    for (const i of MARKET_INSTRUMENTS) {
      expect(i.sourceSymbol.length).toBeGreaterThan(0);
      expect(["fred", "nasdaq", "metal"]).toContain(i.source);
    }
  });

  it("враждебного источника на табло не осталось ни у одной карточки", () => {
    // 21 ноября 2026 Yahoo отвечал нашему адресу 429 на всё, и карточка,
    // которую нечем наполнить, на табло не держится: фьючерс на S&P снят (его
    // цену без ключа не отдаёт никто, а сам индекс стоит своей карточкой),
    // нефть и газ читаются спотовыми рядами FRED.
    const sources = new Set(MARKET_INSTRUMENTS.map((i) => i.source));
    expect([...sources].sort()).toEqual(["fred", "metal", "nasdaq"]);
    const energy = MARKET_INSTRUMENTS.filter((i) => i.group === "energy");
    expect(energy.map((i) => [i.symbol, i.sourceSymbol])).toEqual([
      ["WTI", "DCOILWTICO"],
      ["NGAS", "DHHNGSP"],
    ]);
  });

  it("isMarketSymbol знает свои ключи и не знает чужих", () => {
    expect(isMarketSymbol("XAU")).toBe(true);
    // Ключи прежней формы — чужие: снимок с ними должен отсеиваться, а не
    // оставаться на табло вторыми карточками того же металла. Так же уходит
    // снятая карточка: «ES=F» в снимке не оживает.
    expect(isMarketSymbol("GC=F")).toBe(false);
    expect(isMarketSymbol("^DJI")).toBe(false);
    expect(isMarketSymbol("ES=F")).toBe(false);
  });
});

/**
 * Порядок обхода. Служба, режущая частоту, отказывает **началу** обхода,
 * поэтому очередь строится по нашему собственному факту — когда мы об
 * инструменте спрашивали, — а не по штампу котировки: штамп принадлежит рынку,
 * у закрытого рынка он не двигается, и такой инструмент навсегда оставался
 * самым ветхим, навсегда стоял первым и навсегда получал 429.
 */
describe("marketFetchOrder", () => {
  const at = (k: number) => `2026-11-18T10:${String(k).padStart(2, "0")}:00.000Z`;

  it("ещё не спрошенные идут первыми, в порядке списка", () => {
    const order = marketFetchOrder({ DJI: at(0), XAU: at(0) });
    expect(order.map((i) => i.symbol).slice(0, 3)).toEqual(["IXIC", "GSPC", "WTI"]);
    expect(order).toHaveLength(MARKET_INSTRUMENTS.length);
  });

  it("спрошенные раньше идут раньше спрошенных позже", () => {
    const asked = Object.fromEntries(MARKET_INSTRUMENTS.map((i, k) => [i.symbol, at(k)]));
    const order = marketFetchOrder(asked);
    expect(order[0].symbol).toBe("DJI");
    expect(order[order.length - 1].symbol).toBe("XPD");
  });

  it("отказ по частоте очередь двигает: спрошенный уходит в хвост", () => {
    const asked: Record<string, string> = {};
    const head = marketFetchOrder(asked).slice(0, 2).map((i) => i.symbol);
    expect(head).toEqual(["DJI", "IXIC"]);
    for (const symbol of head) asked[symbol] = at(0);
    const next = marketFetchOrder(asked);
    expect(next.slice(0, 2).map((i) => i.symbol)).toEqual(["GSPC", "WTI"]);
    expect(next.slice(-2).map((i) => i.symbol)).toEqual(head);
  });

  it("пустая карта спросов — порядок списка", () => {
    expect(marketFetchOrder({}).map((i) => i.symbol)).toEqual(MARKET_INSTRUMENTS.map((i) => i.symbol));
  });

  it("чужой символ в карте спросов обход не ломает", () => {
    expect(marketFetchOrder({ "GC=F": at(0) })).toHaveLength(MARKET_INSTRUMENTS.length);
  });
});

/**
 * Отказ по частоте — свойство окна одной службы, поэтому обход прекращается
 * только у неё: у двух остальных свой бюджет, и отказ FRED не повод оставить
 * табло без металлов. (Замер 18 ноября на Yahoo: около одной котировки в
 * полминуты, и от паузы между запросами это не зависело.)
 */
describe("fetchMarkets", () => {
  const throttled = () => new Response("Too Many Requests", { status: 429 });
  const answer = (url: string): Response => {
    const u = String(url);
    if (u.includes("fredgraph.csv")) {
      const id = u.split("id=")[1];
      return new Response(`observation_date,${id}\n2026-11-19,2\n2026-11-20,3\n`, { status: 200 });
    }
    if (u.includes("api.nasdaq.com")) {
      return new Response(
        JSON.stringify({ data: { symbol: "COMP", primaryData: { lastSalePrice: "4", percentageChange: "1%" } } }),
        { status: 200 },
      );
    }
    const metal = u.split("/price/")[1];
    return new Response(
      JSON.stringify({ symbol: metal, price: 5, currency: "USD", updatedAt: "2026-11-21T07:21:37Z" }),
      { status: 200 },
    );
  };

  it("берёт всё табло, когда все три службы отвечают", async () => {
    const { quotes, asked } = await fetchMarkets(MARKET_INSTRUMENTS, { gapMs: 0, fetchImpl: async (u) => answer(u as string) });
    expect(quotes).toHaveLength(9);
    expect(asked).toHaveLength(9);
  });

  it("отказ одной службы по частоте не лишает табло чужих карточек", async () => {
    // Главное решение: счёт отказов — по источнику, а не на всё табло. Один
    // счёт означал бы, что три 429 от FRED гасят металлы и Nasdaq, за которыми
    // стоят совсем другие службы.
    const { quotes } = await fetchMarkets(MARKET_INSTRUMENTS, {
      gapMs: 0,
      fetchImpl: async (u) => (String(u).includes("fredgraph.csv") ? throttled() : answer(u as string)),
    });
    expect(quotes.map((q) => q.symbol).sort()).toEqual(["IXIC", "XAG", "XAU", "XPD", "XPT"]);
  });

  it("прекращает обход источника после трёх отказов по частоте подряд", async () => {
    const seen: string[] = [];
    const fredOnly = [...MARKET_INSTRUMENTS].filter((i) => i.source === "fred");
    expect(fredOnly).toHaveLength(4);
    const { quotes, asked } = await fetchMarkets(fredOnly, {
      gapMs: 0,
      fetchImpl: async (u) => {
        seen.push(String(u));
        return throttled();
      },
    });
    expect(quotes).toEqual([]);
    expect(asked).toEqual(["DJI", "GSPC", "WTI"]);
    expect(seen).toHaveLength(3);
  });

  it("прошедшая котировка счёт отказов обнуляет", async () => {
    let n = 0;
    const { quotes, asked } = await fetchMarkets(
      MARKET_INSTRUMENTS.filter((i) => i.source === "metal"),
      {
        gapMs: 0,
        fetchImpl: async (u) => (++n % 2 === 0 ? answer(u as string) : throttled()),
      },
    );
    expect(asked).toHaveLength(4);
    expect(quotes).toHaveLength(2);
  });

  it("сообщает, о чём спросил: отказ по частоте — тоже спрос", async () => {
    const { quotes, asked } = await fetchMarkets(MARKET_INSTRUMENTS, { gapMs: 0, fetchImpl: async () => throttled() });
    expect(quotes).toEqual([]);
    // По три спроса на каждую службу: дальше — заведомые отказы. У Nasdaq
    // карточка одна, поэтому до трёх ей дойти нечем.
    expect(asked).toEqual(["DJI", "IXIC", "GSPC", "WTI", "XAU", "XAG", "XPT"]);
  });

  it("отказ не по частоте обход не прекращает — он про инструмент, а не про бюджет", async () => {
    const { quotes, asked } = await fetchMarkets(MARKET_INSTRUMENTS, {
      gapMs: 0,
      fetchImpl: async (u) => (String(u).includes("XAU") ? new Response("Not Found", { status: 404 }) : answer(u as string)),
    });
    expect(asked).toHaveLength(9);
    expect(quotes.map((q) => q.symbol)).not.toContain("XAU");
    expect(quotes).toHaveLength(8);
  });
});

/**
 * Самая ветхая карточка табло — это и есть здоровье источников. Мерить его
 * временем записи снимка нельзя: пустой ответ его перезаписывает, то есть
 * время записи всегда свежее. Штамп нашего взятия у каждой карточки свой, и
 * ветхая карточка называет свой источник — отчёт говорит, какая из трёх
 * служб замолчала.
 */
describe("stalestQuote", () => {
  const q = (symbol: string, gotAt?: string) => ({ symbol, source: "yahoo", gotAt }) as never;

  it("возвращает самую давнюю карточку, а не только её возраст", () => {
    const found = stalestQuote([
      q("DJI", "2026-11-20T14:00:00.000Z"),
      q("XAU", "2026-11-20T09:30:00.000Z"),
      q("XAG", "2026-11-20T12:00:00.000Z"),
    ]);
    expect(found?.quote.symbol).toBe("XAU");
    expect(found?.at.toISOString()).toBe("2026-11-20T09:30:00.000Z");
  });

  it("пустое табло — возраст неизвестен, а не нулевой", () => {
    expect(stalestQuote([])).toBeNull();
    expect(stalestQuoteAt([])).toBeNull();
  });

  it("снимок прежней формы без штампов читается как «неизвестно»", () => {
    expect(stalestQuoteAt([q("DJI"), q("XAU")])).toBeNull();
  });

  it("карточка без штампа рядом со штампованными не прячет ветхую", () => {
    expect(stalestQuoteAt([q("DJI"), q("XAU", "2026-11-20T09:30:00.000Z")])?.toISOString()).toBe(
      "2026-11-20T09:30:00.000Z",
    );
  });
});
