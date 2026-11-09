import { describe, expect, it } from "vitest";
import {
  NATIVE_CHAIN_KEYS,
  resolveSubstrateChain,
  SUBSTRATE_CHAINS,
  substrateIssuanceUrlFor,
  substrateRpcUrlFor,
} from "../src/lib/substrate-chains";

describe("resolveSubstrateChain", () => {
  it("находит сеть по ключу и по написанию с заглавной", () => {
    expect(resolveSubstrateChain("taler")?.key).toBe("taler");
    expect(resolveSubstrateChain("Taler")?.key).toBe("taler");
    expect(resolveSubstrateChain(" polkadot ")?.key).toBe("polkadot");
  });

  it("родовое слово «substrate» сетью не считается", () => {
    expect(resolveSubstrateChain("substrate")).toBeNull();
    expect(resolveSubstrateChain("")).toBeNull();
    expect(resolveSubstrateChain(null)).toBeNull();
    expect(resolveSubstrateChain("ethereum")).toBeNull();
  });

  it("ключи для формы совпадают с реестром", () => {
    expect(NATIVE_CHAIN_KEYS).toEqual(SUBSTRATE_CHAINS.map((c) => c.key));
  });
});

describe("substrateRpcUrlFor", () => {
  const taler = resolveSubstrateChain("taler")!;

  it("по умолчанию берёт адрес из реестра", () => {
    expect(substrateRpcUrlFor(taler, {})).toBe("https://node.taler.uno");
  });

  it("переопределение из окружения важнее реестра", () => {
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "https://alt.example" })).toBe(
      "https://alt.example",
    );
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "   " })).toBe(
      "https://node.taler.uno",
    );
  });
});

describe("пришпиленные индексы палеты балансов (слайсы T и V)", () => {
  // Проверены живым payment_queryInfo: taler/polkadot/kusama — 7 ноября 2026,
  // остальные — 9 ноября. Индекс подтверждён дважды: комиссию считает и
  // transfer_keep_alive (вызов 3), и transfer_allow_death (вызов 0), и они
  // расходятся на доли процента. У ложного индекса вызов 0 не декодируется.
  it.each([
    ["taler", 6, 2],
    ["polkadot", 5, 26],
    ["kusama", 4, 26],
    ["bittensor", 5, 1],
    ["astar", 31, 3],
    ["peaq", 4, 2],
    ["creditcoin", 3, 4],
    ["enjin", 6, 18],
    ["polymesh", 5, 8],
    ["avail", 6, 1],
  ])("%s: палета %i, версия транзакций %i", (key, pallet, txVersion) => {
    const chain = resolveSubstrateChain(key as string)!;
    expect(chain.balancesPallet).toBe(pallet);
    expect(chain.transactionVersion).toBe(txVersion);
  });

  // Сеть, у которой комиссию прочитать не удалось, честно хранит null, а не
  // индекс наугад: у HydraDX не совпал набор подписанных расширений, у
  // Moonbeam и Moonriver адреса 20-байтные и MultiAddress не применяется.
  // Слайс W добавил четыре таких сети: у Acala и Unique перевод не
  // декодируется ни при одном индексе, у Vara подтверждение слабое (комиссии
  // двух вызовов расходятся в 1,56 раза), у Darwinia адреса 20-байтные.
  it.each(["hydradx", "moonbeam", "moonriver", "acala", "darwinia", "vara", "unique"])(
    "%s: комиссия не читается",
    (key) => {
      const chain = resolveSubstrateChain(key)!;
      expect(chain.balancesPallet).toBeNull();
      expect(chain.transactionVersion).toBeNull();
    },
  );
});

describe("реестр как целое", () => {
  it("ключи уникальны, адреса узлов заданы, тикеры в верхнем регистре", () => {
    const keys = SUBSTRATE_CHAINS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of SUBSTRATE_CHAINS) {
      expect(c.defaultRpcUrl).toMatch(/^https:\/\//);
      expect(c.symbol).toBe(c.symbol.toUpperCase());
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("семнадцать сетей в реестре", () => {
    expect(SUBSTRATE_CHAINS).toHaveLength(17);
  });
});

describe("substrateIssuanceUrlFor", () => {
  // Балансы Polkadot и Kusama переехали в Asset Hub: на релее
  // Balances.TotalIssuance отдаёт остаток (245 862 DOT против 1 711 256 874 на
  // Asset Hub), и карточка получила бы выпуск, занижённый в тысячи раз.
  it("выпуск Polkadot и Kusama читается с Asset Hub", () => {
    expect(substrateIssuanceUrlFor(resolveSubstrateChain("polkadot")!, {})).toBe(
      "https://polkadot-asset-hub-rpc.polkadot.io",
    );
    expect(substrateIssuanceUrlFor(resolveSubstrateChain("kusama")!, {})).toBe(
      "https://kusama-asset-hub-rpc.polkadot.io",
    );
  });

  it("у остальных сетей выпуск там же, где и всё прочее", () => {
    const taler = resolveSubstrateChain("taler")!;
    expect(substrateIssuanceUrlFor(taler, {})).toBe(substrateRpcUrlFor(taler, {}));
  });

  it("переопределение выпуска важнее реестра, а общего — важнее только своего", () => {
    const dot = resolveSubstrateChain("polkadot")!;
    expect(
      substrateIssuanceUrlFor(dot, { SUBSTRATE_ISSUANCE_RPC_POLKADOT: "https://ah.example" }),
    ).toBe("https://ah.example");
    // Переопределив общий адрес, администратор не должен внезапно вернуться на
    // релей: адрес выпуска у этой сети свой и остаётся на месте.
    expect(substrateIssuanceUrlFor(dot, { SUBSTRATE_RPC_POLKADOT: "https://relay.example" })).toBe(
      "https://polkadot-asset-hub-rpc.polkadot.io",
    );
    const taler = resolveSubstrateChain("taler")!;
    expect(substrateIssuanceUrlFor(taler, { SUBSTRATE_RPC_TALER: "https://alt.example" })).toBe(
      "https://alt.example",
    );
  });
});
