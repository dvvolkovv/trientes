import { describe, expect, it } from "vitest";
import { exchangeDedupeKey, exchangeIdKey, findExchangeDupes, remapMarketId } from "@/lib/exchange-dedupe";
import { CP_TO_CG_ALIAS, resolveCpId } from "@/lib/coinpaprika";

/**
 * Одна биржа — одна строка каталога. Два источника с разными ключами завели в
 * базе 41 пару двойников, и видно это не только глазом: объём и пары делились
 * между строками, а опознание Coinlore отказывалось от неоднозначного имени.
 */
describe("exchangeDedupeKey", () => {
  it("сравнивает имена без регистра и знаков", () => {
    expect(exchangeDedupeKey("Nami.Exchange")).toBe(exchangeDedupeKey("Nami Exchange"));
    expect(exchangeDedupeKey("Quickswap (v3)")).toBe(exchangeDedupeKey("Quickswap V3"));
    expect(exchangeDedupeKey("CEX.IO")).toBe("cexio");
  });

  it("разные биржи одним ключом не становятся", () => {
    expect(exchangeDedupeKey("Uniswap V3 (BSC)")).not.toBe(exchangeDedupeKey("Uniswap V3 (Celo)"));
  });
});

describe("findExchangeDupes", () => {
  const row = (id: string, name: string, source: string) => ({ id, name, source });

  it("главной остаётся строка CoinGecko — её каждый час находит основной прогон", () => {
    const { groups, refused } = findExchangeDupes([
      row("gate", "Gate", "cg"),
      row("gateio", "Gate", "cp"),
      row("kraken", "Kraken", "cg"),
    ]);
    expect(refused).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe("gate");
    expect(groups[0].merged.map((r) => r.id)).toEqual(["gateio"]);
  });

  it("без строки CoinGecko — отказ с причиной, а не выбор по объёму", () => {
    // Удали строку CoinPaprika, не зная, какая из двух главная, — и ближайший
    // прогон заведёт её заново: удаление было бы работой, которую отменят.
    const { groups, refused } = findExchangeDupes([
      row("foo", "Foo Exchange", "cp"),
      row("foo-exchange", "Foo Exchange", "cp"),
    ]);
    expect(groups).toEqual([]);
    expect(refused).toEqual([
      { key: "fooexchange", rows: [row("foo", "Foo Exchange", "cp"), row("foo-exchange", "Foo Exchange", "cp")], reason: "no_cg_row" },
    ]);
  });

  it("две строки CoinGecko под одним именем — тоже отказ", () => {
    const { groups, refused } = findExchangeDupes([
      row("a", "Same Name", "cg"),
      row("b", "Same Name", "cg"),
      row("c", "Same Name", "cp"),
    ]);
    expect(groups).toEqual([]);
    expect(refused[0].reason).toBe("many_cg_rows");
  });

  it("ключ, различающийся только разделителем, — та же биржа, хоть имена разные", () => {
    // Живой обход 25 ноября: трое двойников пережили слияние 21 ноября, потому
    // что искали по имени, а у них имена разные — «Bybit (Spot)» против
    // «Bybit», «BTC-Alpha» против «ALP.COM», «Ondo Global Markets» против
    // «Ondo Stocks». Совпал у них ключ: дефис против подчёркивания.
    const { groups, refused } = findExchangeDupes([
      row("bybit_spot", "Bybit", "cg"),
      row("bybit-spot", "Bybit (Spot)", "cp"),
      row("btc_alpha", "ALP.COM", "cg"),
      row("btc-alpha", "BTC-Alpha", "cp"),
      row("kraken", "Kraken", "cg"),
    ]);
    expect(refused).toEqual([]);
    expect(groups.map((g) => [g.canonical.id, g.merged.map((m) => m.id)])).toEqual([
      ["btc_alpha", ["btc-alpha"]],
      ["bybit_spot", ["bybit-spot"]],
    ]);
  });

  it("разные площадки одного бренда ключом не сливаются", () => {
    // `uniswap_v3` и `uniswap-v3-bsc` — разные сети, и ни имя, ни ключ их не
    // путают: у ключа без разделителей `uniswapv3` против `uniswapv3bsc`.
    const { groups } = findExchangeDupes([
      row("uniswap_v3", "Uniswap V3 (Ethereum)", "cg"),
      row("uniswap-v3-bsc", "Uniswap V3 (BSC)", "cg"),
    ]);
    expect(groups).toEqual([]);
  });

  it("группа собирается по имени и по ключу разом, а правило главной одно", () => {
    // Имя связывает a и b, ключ — b и c: это одна биржа тремя строками, и
    // главной остаётся единственная строка CoinGecko.
    const { groups, refused } = findExchangeDupes([
      row("alpha_x", "Alpha X", "cg"),
      row("alphax", "Alpha X", "cp"),
      row("alpha-x", "Alpha X Pro", "cp"),
    ]);
    expect(refused).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe("alpha_x");
    expect(groups[0].merged.map((r) => r.id).sort()).toEqual(["alpha-x", "alphax"]);
  });

  it("одиночная строка группой не считается", () => {
    expect(findExchangeDupes([row("kraken", "Kraken", "cg")])).toEqual({ groups: [], refused: [] });
  });
});

describe("remapMarketId", () => {
  it("переписывает только приставку биржи — ключ составной", () => {
    expect(remapMarketId("gateio:BTC:USDT:spot", "gateio", "gate")).toBe("gate:BTC:USDT:spot");
  });

  it("имя биржи внутри пары не трогает", () => {
    // Слепая замена по всей строке испортила бы тикер: «GATE» бывает базой.
    expect(remapMarketId("gateio:GATEIO:USDT:spot", "gateio", "gate")).toBe("gate:GATEIO:USDT:spot");
  });

  it("чужой ключ не переписывается", () => {
    expect(remapMarketId("binance:BTC:USDT:spot", "gateio", "gate")).toBeNull();
  });
});

/**
 * Карта псевонимов — единственное, что не даёт двойнику завестись заново, и
 * единственный источник редиректа со снятого ключа. Поэтому её форма проверяется
 * тестом: цепочка или ключ, равный значению, тихо вернули бы вторую строку.
 */
describe("CP_TO_CG_ALIAS", () => {
  it("41 расхождение слияния 21 ноября, Coinbase и трое двойников 25 ноября", () => {
    expect(Object.keys(CP_TO_CG_ALIAS)).toHaveLength(45);
  });

  it("ни один ключ не ведёт в себя", () => {
    for (const [from, to] of Object.entries(CP_TO_CG_ALIAS)) expect(from).not.toBe(to);
  });

  it("цепочек нет: цель псевонима сама псевонимом не является", () => {
    for (const to of Object.values(CP_TO_CG_ALIAS)) {
      expect(CP_TO_CG_ALIAS[to]).toBeUndefined();
      expect(resolveCpId(to)).toBe(to);
    }
  });

  it("две биржи не ведут в одну строку", () => {
    const targets = Object.values(CP_TO_CG_ALIAS);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("exchangeIdKey", () => {
  it("разделители ключа значения не имеют", () => {
    expect(exchangeIdKey("bybit-spot")).toBe(exchangeIdKey("bybit_spot"));
    expect(exchangeIdKey("Gate.IO")).toBe("gateio");
  });

  it("разные ключи разными и остаются", () => {
    expect(exchangeIdKey("uniswap_v3")).not.toBe(exchangeIdKey("uniswap-v3-bsc"));
  });
});
