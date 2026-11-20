import { describe, expect, it } from "vitest";

import {
  CL_TIMEOUT_MS,
  COINLORE_ALIASES,
  PAIR_MAX_AGE_MS,
  matchExchange,
  parseCoinloreExchanges,
  parseCoinlorePairs,
} from "@/lib/coinlore";

describe("разбор ответов Coinlore", () => {
  it("список: ключ объекта — id службы", () => {
    const list = parseCoinloreExchanges({
      "5": { id: "5", name: "Binance", name_id: "binance", volume_usd: 1e9, active_pairs: 908, url: "https://binance.com", country: "Japan" },
      "739": { id: "739", name: "Websea", name_id: "websea", volume_usd: 1e7, active_pairs: 70, url: null, country: null },
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "5", nameId: "binance", activePairs: 908, volumeUsd: 1e9, country: "Japan" });
  });

  it("строка не той формы выбрасывается, а не превращается в нули", () => {
    const list = parseCoinloreExchanges({
      "1": { name: "Broken" },
      "2": { id: "2", name: "Ok", name_id: "ok", volume_usd: 1, active_pairs: 1 },
    });
    expect(list.map((e) => e.nameId)).toEqual(["ok"]);
  });

  it("отсутствующее число — null, а не ноль", () => {
    const [e] = parseCoinloreExchanges({ "1": { id: 1, name: "X", name_id: "x" } });
    expect(e.volumeUsd).toBeNull();
    expect(e.activePairs).toBeNull();
  });

  it("пары: цена в долларах, объём в долларах, время сделки", () => {
    const pairs = parseCoinlorePairs({
      pairs: [{ base: "btc", quote: "usdt", volume: 1.4e9, price: 61700, price_usd: 61700, time: 1795160670 }],
    });
    expect(pairs[0]).toMatchObject({ base: "BTC", quote: "USDT", priceUsd: 61700, volumeUsd: 1.4e9 });
    expect(pairs[0].tradedAt?.getTime()).toBe(1795160670 * 1000);
  });

  it("пара без базы или котировки не берётся", () => {
    expect(parseCoinlorePairs({ pairs: [{ base: "", quote: "USDT" }] })).toEqual([]);
  });

  it("ответ не того вида даёт пустой список, а не исключение", () => {
    expect(parseCoinlorePairs({ pairs: "нет" })).toEqual([]);
    expect(parseCoinloreExchanges(null)).toEqual([]);
  });
});

describe("опознание биржи", () => {
  it("точный ключ сильнее похожего имени", () => {
    const ours = [{ id: "binance", name: "Binance" }, { id: "binance-us", name: "Binance US" }];
    expect(matchExchange({ nameId: "binance", name: "Binance" }, ours)).toBe("binance");
  });

  it("пришпиленный псевдоним закрывает известное расхождение", () => {
    expect(COINLORE_ALIASES.coinbase).toBe("gdax");
    expect(matchExchange({ nameId: "coinbase", name: "Coinbase" }, [{ id: "gdax", name: "Coinbase Exchange" }])).toBe("gdax");
  });

  it("псевдоним без своей строки в каталоге не применяется", () => {
    expect(matchExchange({ nameId: "coinbase", name: "Coinbase" }, [{ id: "binance", name: "Binance" }])).toBeNull();
  });

  it("ключ сходится и при разном написании, если наша строка одна", () => {
    expect(matchExchange({ nameId: "bybit-spot", name: "Bybit" }, [{ id: "bybit_spot", name: "Bybit" }])).toBe("bybit_spot");
  });

  it("точный ключ сильнее неоднозначности написаний: эта строка и есть наша", () => {
    const ours = [{ id: "bybit_spot", name: "Bybit" }, { id: "bybit-spot", name: "Bybit (Spot)" }];
    expect(matchExchange({ nameId: "bybit-spot", name: "Нечто" }, ours)).toBe("bybit-spot");
  });

  it("два наших написания одного ключа — отказ, а не выбор первого", () => {
    const ours = [{ id: "bybit_spot", name: "Bybit" }, { id: "bybit-spot", name: "Bybit (Spot)" }];
    expect(matchExchange({ nameId: "bybitspot", name: "Нечто" }, ours)).toBeNull();
  });

  it("имя сходится, когда наша строка одна", () => {
    expect(matchExchange({ nameId: "xeggex-pro", name: "XeggeX" }, [{ id: "xeggex", name: "XeggeX" }])).toBe("xeggex");
  });

  it("неоднозначное имя — отказ: у Coinlore один Uniswap, у нас их сорок", () => {
    const ours = [
      { id: "uniswap-v2", name: "Uniswap V2 (Ethereum)" },
      { id: "uniswap_v2", name: "Uniswap V2 (Ethereum)" },
    ];
    expect(matchExchange({ nameId: "uniswap", name: "Uniswap V2 (Ethereum)" }, ours)).toBeNull();
  });

  it("не нашлось — null, и зовущий считает это вслух", () => {
    expect(matchExchange({ nameId: "zke", name: "ZKE" }, [{ id: "binance", name: "Binance" }])).toBeNull();
  });
});

describe("границы клиента", () => {
  it("срок запроса и предел ветхости пары названы числами", () => {
    expect(CL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PAIR_MAX_AGE_MS).toBe(7 * 24 * 3600 * 1000);
  });
});
