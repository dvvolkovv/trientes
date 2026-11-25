import { describe, it, expect } from "vitest";
import { parseCoinPaprikaExchange, cpTypeToExchangeType, resolveCpId, matchCpExchangeId, CP_TO_CG_ALIAS } from "@/lib/coinpaprika";

describe("parseCoinPaprikaExchange", () => {
  const sample = {
    id: "richamster",
    name: "Richamster",
    type: ["cex"],
    description: "Short description.",
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 217,
    currencies: 24,
    fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
    quotes: { USD: { adjusted_volume_24h: 77211.14 } },
    links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    last_updated: "2026-05-26T19:27:34Z",
  };

  it("parses a well-formed CoinPaprika exchange", () => {
    const out = parseCoinPaprikaExchange(sample);
    expect(out).toEqual({
      id: "richamster",
      name: "Richamster",
      type: ["cex"],
      description: "Short description.",
      active: true,
      markets_data_fetched: true,
      adjusted_rank: 217,
      currencies: 24,
      fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
      volume24hUsd: 77211.14,
      links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    });
  });

  it("returns null on malformed payload (missing id)", () => {
    expect(parseCoinPaprikaExchange({ name: "X" })).toBeNull();
  });

  it("defaults missing volume to 0", () => {
    const v = parseCoinPaprikaExchange({ ...sample, quotes: {} });
    expect(v?.volume24hUsd).toBe(0);
  });
});

describe("cpTypeToExchangeType", () => {
  it("maps cex to CEX", () => {
    expect(cpTypeToExchangeType(["cex"])).toBe("CEX");
  });
  it("maps dex to DEX", () => {
    expect(cpTypeToExchangeType(["dex"])).toBe("DEX");
  });
  it("maps both cex and dex to HYBRID", () => {
    expect(cpTypeToExchangeType(["cex", "dex"])).toBe("HYBRID");
  });
  it("maps spot to CEX", () => {
    expect(cpTypeToExchangeType(["spot"])).toBe("CEX");
  });
  it("maps perpetuals to CEX", () => {
    expect(cpTypeToExchangeType(["perpetuals"])).toBe("CEX");
  });
  it("maps other to OTHER", () => {
    expect(cpTypeToExchangeType(["other"])).toBe("OTHER");
  });
  it("returns null for empty array", () => {
    expect(cpTypeToExchangeType([])).toBeNull();
  });
});

describe("resolveCpId", () => {
  it("returns the alias target when present", () => {
    expect(resolveCpId("coinbase")).toBe("gdax");
  });
  it("returns the input id when no alias is set", () => {
    expect(resolveCpId("xeggex")).toBe("xeggex");
  });
  it("CP_TO_CG_ALIAS contains the coinbase→gdax mapping", () => {
    expect(CP_TO_CG_ALIAS.coinbase).toBe("gdax");
  });
});

describe("matchCpExchangeId", () => {
  const ours = ["gdax", "bybit_spot", "btc_alpha", "xeggex", "uniswap_v2", "uniswap-v2-base"];

  it("пришпиленный псевдоним сильнее всего", () => {
    expect(matchCpExchangeId("coinbase", ours)).toBe("gdax");
  });

  it("точный ключ — наш ключ", () => {
    expect(matchCpExchangeId("xeggex", ours)).toBe("xeggex");
  });

  it("ключ, различающийся только разделителем, — та же биржа", () => {
    // Живой случай 25 ноября: у CoinPaprika дефис, у CoinGecko подчёркивание, и
    // в каталоге стояли две строки одной биржи — `bybit-spot` и `bybit_spot`.
    expect(matchCpExchangeId("bybit-spot", ours)).toBe("bybit_spot");
    expect(matchCpExchangeId("btc-alpha", ours)).toBe("btc_alpha");
  });

  it("неоднозначный ключ — отказ, а не выбор первого", () => {
    // Пришпиленный псевдоним тут не спасает и не должен: проверяем ключ, которого
    // в карте нет, — у него две наши строки, и выбор любой был бы догадкой.
    expect(matchCpExchangeId("fresh-dex", ["fresh_dex", "freshdex"])).toBeNull();
  });

  it("пришпиленный псевдоним сильнее неоднозначности: ответ дан руками", () => {
    expect(matchCpExchangeId("bybit-spot", [...ours, "bybitspot"])).toBe("bybit_spot");
  });

  it("незнакомая биржа — отказ: строку заведёт сам прогон", () => {
    expect(matchCpExchangeId("brand-new", ours)).toBeNull();
  });

  it("псевдоним на строку, которой у нас нет, не выдумывает её", () => {
    expect(matchCpExchangeId("coinbase", ["binance"])).toBeNull();
  });

  it("по имени не опознаёт: у служб имена одной биржи разные", () => {
    // `btc-alpha` у CoinPaprika зовётся «BTC-Alpha», а у нас — «ALP.COM»: имя
    // доказательством быть не может, и совпадения по нему мы не ищем.
    expect(matchCpExchangeId("alp-com", ours)).toBeNull();
  });

  it("разные площадки под одним доменом не сливаются", () => {
    // `Uniswap V2 (Base)` и `Uniswap V2 (Ethereum)` — разные строки каталога, и
    // нормализация ключа их не путает.
    expect(matchCpExchangeId("uniswap-v2-base", ours)).toBe("uniswap-v2-base");
    expect(matchCpExchangeId("uniswap-v2", ours)).toBe("uniswap_v2");
  });
});

describe("CP_TO_CG_ALIAS — двойники, найденные живым обходом 2026-11-25", () => {
  it.each([
    ["bybit-spot", "bybit_spot"],
    ["btc-alpha", "btc_alpha"],
    ["ondo-global-markets", "ondo_global_markets"],
  ])("%s → %s", (cp, ours) => {
    expect(resolveCpId(cp)).toBe(ours);
  });
});
