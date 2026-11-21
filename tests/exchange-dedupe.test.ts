import { describe, expect, it } from "vitest";
import { exchangeDedupeKey, findExchangeDupes, remapMarketId } from "@/lib/exchange-dedupe";
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
  it("все 41 найденных расхождения плюс Coinbase", () => {
    expect(Object.keys(CP_TO_CG_ALIAS)).toHaveLength(42);
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
