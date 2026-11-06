import { describe, it, expect } from "vitest";
import { SELECTORS } from "../src/lib/evm-abi";
import type { FetchLike } from "../src/lib/evm-rpc";
import {
  applyOnchainTotal,
  compareClaims,
  flagsFromBytecode,
  isVerified,
  readContractFacts,
  totalSupplyInCoins,
  verifyCardContracts,
  type ContractFacts,
} from "../src/lib/coin-card-onchain";

const ADDRESS = "0x" + "a".repeat(40);

function uintWord(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

function stringWord(s: string): string {
  const hex = Buffer.from(s, "utf8").toString("hex");
  return (
    "0x" +
    (32).toString(16).padStart(64, "0") +
    Buffer.byteLength(s).toString(16).padStart(64, "0") +
    hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0")
  );
}

/** Узел, который отвечает по сценарию. Сети в тестах нет вообще. */
function fakeNode(opts: {
  code?: string;
  name?: string;
  symbol?: string;
  decimals?: bigint;
  totalSupply?: bigint;
  slot?: string;
  httpFail?: boolean;
  rpcError?: string;
}): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
    calls.push(body.method);
    if (opts.httpFail) return { ok: false, status: 503, json: async () => ({}) };
    if (opts.rpcError) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ error: { message: opts.rpcError } }),
      };
    }
    let result = "0x";
    if (body.method === "eth_getCode") result = opts.code ?? "0x6080604052";
    if (body.method === "eth_getStorageAt") result = opts.slot ?? uintWord(BigInt(0));
    if (body.method === "eth_call") {
      const data = (body.params[0] as { data: string }).data;
      if (data === SELECTORS.name) result = opts.name ? stringWord(opts.name) : "0x";
      if (data === SELECTORS.symbol) result = opts.symbol ? stringWord(opts.symbol) : "0x";
      if (data === SELECTORS.decimals) {
        result = opts.decimals != null ? uintWord(opts.decimals) : "0x";
      }
      if (data === SELECTORS.totalSupply) {
        result = opts.totalSupply != null ? uintWord(opts.totalSupply) : "0x";
      }
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, calls };
}

const facts = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  totalSupply: "1000000000000",
  flags: [],
  error: null,
  ...over,
});

describe("flagsFromBytecode", () => {
  it("на пустом коде флагов нет", () => {
    expect(flagsFromBytecode("0x")).toEqual([]);
  });

  it("находит выпуск, паузу, чёрный список и прокси", () => {
    const code =
      "0x6080" +
      SELECTORS.mint.slice(2) +
      SELECTORS.paused.slice(2) +
      SELECTORS.blacklist.slice(2) +
      SELECTORS.upgradeTo.slice(2) +
      SELECTORS.owner.slice(2);
    expect(flagsFromBytecode(code)).toEqual([
      "MINTABLE",
      "PAUSABLE",
      "BLACKLIST",
      "UPGRADEABLE_PROXY",
      "OWNED",
    ]);
  });

  it("обычный токен без выпуска флага MINTABLE не получает", () => {
    expect(flagsFromBytecode("0x6080" + SELECTORS.owner.slice(2))).toEqual(["OWNED"]);
  });
});

describe("totalSupplyInCoins", () => {
  it("делит на decimals", () => {
    expect(totalSupplyInCoins("1000000000000", 6)).toBe(1_000_000);
  });

  it("без decimals считать нечего", () => {
    expect(totalSupplyInCoins("1000", null)).toBeNull();
    expect(totalSupplyInCoins(null, 18)).toBeNull();
    expect(totalSupplyInCoins("не число", 18)).toBeNull();
  });
});

describe("compareClaims", () => {
  const claim = { chain: "ethereum", address: ADDRESS, decimals: 6, name: "USD Coin", symbol: "USDC" };

  it("совпадение не даёт расхождений", () => {
    expect(compareClaims(claim, facts())).toEqual([]);
  });

  it("регистр и пробелы расхождением не считаются", () => {
    expect(compareClaims(claim, facts({ symbol: " usdc ", name: "usd coin" }))).toEqual([]);
  });

  it("чужой тикер — расхождение", () => {
    expect(compareClaims(claim, facts({ symbol: "USDT" }))).toEqual(["SYMBOL"]);
  });

  it("чужое имя — расхождение", () => {
    expect(compareClaims(claim, facts({ name: "Tether USD" }))).toEqual(["NAME"]);
  });

  it("другие decimals — расхождение", () => {
    expect(compareClaims(claim, facts({ decimals: 18 }))).toContain("DECIMALS");
  });

  it("выпуск сверяется с допуском на округление", () => {
    const near = { ...claim, totalSupply: 1_000_500 };
    expect(compareClaims(near, facts())).toEqual([]);
    const far = { ...claim, totalSupply: 500_000 };
    expect(compareClaims(far, facts())).toEqual(["TOTAL_SUPPLY"]);
  });

  it("при ошибке сверки расхождений не выдумываем", () => {
    expect(compareClaims(claim, facts({ error: "rpc_unreachable" }))).toEqual([]);
  });

  it("незаявленное поле не сверяется", () => {
    expect(compareClaims({ chain: "ethereum", address: ADDRESS }, facts())).toEqual([]);
  });
});

describe("isVerified", () => {
  it("проверено только когда сошлось", () => {
    expect(isVerified(facts(), [])).toBe(true);
    expect(isVerified(facts(), ["SYMBOL"])).toBe(false);
    expect(isVerified(facts({ error: "not_a_contract" }), [])).toBe(false);
    expect(isVerified(facts({ symbol: null }), [])).toBe(false);
  });
});

describe("applyOnchainTotal", () => {
  const at = new Date("2026-11-06T00:00:00.000Z");

  it("пишет выпуск и помечает его проверенным в сети", () => {
    const r = applyOnchainTotal({ circulating: 10, total: 5 }, facts(), "ethereum", at)!;
    expect(r.tokenomics).toEqual({ circulating: 10, total: 1_000_000 });
    expect(r.provenance["tokenomics.total"]).toEqual({
      kind: "VERIFIED_ONCHAIN",
      source: "ethereum",
      at: at.toISOString(),
    });
  });

  it("без выпуска из сети ничего не пишет", () => {
    expect(applyOnchainTotal({}, facts({ totalSupply: null }), "ethereum", at)).toBeNull();
  });
});

describe("readContractFacts", () => {
  it("читает факты у стандартного токена", async () => {
    const { fetchImpl } = fakeNode({
      name: "USD Coin",
      symbol: "USDC",
      decimals: BigInt(6),
      totalSupply: BigInt(1_000_000_000_000),
    });
    const f = await readContractFacts({ chain: "Ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f).toMatchObject({
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      totalSupply: "1000000000000",
      error: null,
    });
  });

  it("не-EVM сеть не читается и не притворяется прочитанной", async () => {
    const { fetchImpl, calls } = fakeNode({});
    const f = await readContractFacts({ chain: "Substrate", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("chain_unsupported");
    expect(calls).toEqual([]);
  });

  it("кривой адрес до сети не доходит", async () => {
    const { fetchImpl, calls } = fakeNode({});
    const f = await readContractFacts({ chain: "ethereum", address: "0x1" }, { fetchImpl, env: {} });
    expect(f.error).toBe("address_invalid");
    expect(calls).toEqual([]);
  });

  it("пустой код — адрес кошелька, не токена", async () => {
    const { fetchImpl } = fakeNode({ code: "0x" });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("not_a_contract");
  });

  it("недоступный узел — это сбой сверки, а не факт о контракте", async () => {
    const { fetchImpl } = fakeNode({ httpFail: true });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("rpc_unreachable");
  });

  it("ошибка узла не обнуляет остальные поля молча", async () => {
    const { fetchImpl } = fakeNode({ rpcError: "limit exceeded" });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("rpc_error");
  });

  it("прокси по слоту EIP-1967 находится даже без селектора upgradeTo", async () => {
    const impl = "0x" + "0".repeat(24) + "2".repeat(40);
    const { fetchImpl } = fakeNode({ symbol: "USDC", slot: impl });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.flags).toContain("UPGRADEABLE_PROXY");
  });

  it("нестандартный токен без name читается частично", async () => {
    const { fetchImpl } = fakeNode({ symbol: "TAL", decimals: BigInt(10) });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f).toMatchObject({ name: null, symbol: "TAL", decimals: 10, error: null });
  });
});

describe("verifyCardContracts", () => {
  type Updated = { where: { id: string }; data: Record<string, unknown> };

  function fakePrisma(rows: unknown[]) {
    const contractUpdates: Updated[] = [];
    const cardUpdates: Updated[] = [];
    return {
      contractUpdates,
      cardUpdates,
      prisma: {
        coinCardContract: {
          findMany: async () => rows as never,
          update: async (args: Updated) => {
            contractUpdates.push(args);
            return {};
          },
        },
        coinCard: {
          update: async (args: Updated) => {
            cardUpdates.push(args);
            return {};
          },
        },
      },
    };
  }

  const row = {
    id: "c1",
    cardId: "k1",
    chain: "ethereum",
    address: ADDRESS,
    decimals: 6,
    isCanonical: true,
    card: { id: "k1", name: "USD Coin", symbol: "USDC", tokenomics: { total: 1_000_000 }, provenance: {} },
  };

  it("совпавшая сверка ставит verifiedAt и проверенный выпуск", async () => {
    const now = new Date("2026-11-06T05:10:00.000Z");
    const { fetchImpl } = fakeNode({
      name: "USD Coin",
      symbol: "USDC",
      decimals: BigInt(6),
      totalSupply: BigInt(1_000_000_000_000),
    });
    const f = fakePrisma([row]);
    const stats = await verifyCardContracts({ prisma: f.prisma as never, fetchImpl, now });

    expect(stats).toEqual({ checked: 1, verified: 1, mismatched: 0, failed: 0 });
    expect(f.contractUpdates[0].data).toMatchObject({
      onchainSymbol: "USDC",
      onchainDecimals: 6,
      onchainTotalSupply: "1000000000000",
      mismatches: [],
      verifiedAt: now,
      checkError: null,
    });
    expect(f.cardUpdates[0].data.tokenomics).toEqual({ total: 1_000_000 });
  });

  it("расхождение снимает прежнее проверено и не правит токеномику", async () => {
    const { fetchImpl } = fakeNode({ name: "Tether USD", symbol: "USDT", decimals: BigInt(6) });
    const f = fakePrisma([row]);
    const stats = await verifyCardContracts({ prisma: f.prisma as never, fetchImpl });

    expect(stats).toEqual({ checked: 1, verified: 0, mismatched: 1, failed: 0 });
    expect(f.contractUpdates[0].data.mismatches).toEqual(["SYMBOL", "NAME"]);
    expect(f.contractUpdates[0].data.verifiedAt).toBeNull();
    expect(f.cardUpdates).toEqual([]);
  });

  it("сбой сети пишется в checkError и ничего не подтверждает", async () => {
    const { fetchImpl } = fakeNode({ httpFail: true });
    const f = fakePrisma([row]);
    const stats = await verifyCardContracts({ prisma: f.prisma as never, fetchImpl });

    expect(stats).toEqual({ checked: 1, verified: 0, mismatched: 0, failed: 1 });
    expect(f.contractUpdates[0].data).toMatchObject({
      checkError: "rpc_unreachable",
      verifiedAt: null,
    });
    expect(f.cardUpdates).toEqual([]);
  });

  it("неканонический контракт токеномику не переписывает", async () => {
    const { fetchImpl } = fakeNode({
      name: "USD Coin",
      symbol: "USDC",
      decimals: BigInt(6),
      totalSupply: BigInt(1_000_000_000_000),
    });
    const f = fakePrisma([{ ...row, isCanonical: false }]);
    await verifyCardContracts({ prisma: f.prisma as never, fetchImpl });
    expect(f.cardUpdates).toEqual([]);
  });
});

describe("адрес, который только похож на токен", () => {
  it("кошелёк с делегацией EIP-7702 контрактом не считается", async () => {
    const { fetchImpl } = fakeNode({ code: "0xef0100" + "b".repeat(40) });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("not_a_contract");
  });

  it("контракт без геттеров ERC-20 не проходит сверку", async () => {
    const { fetchImpl } = fakeNode({ code: "0x6080604052" });
    const f = await readContractFacts({ chain: "ethereum", address: ADDRESS }, { fetchImpl, env: {} });
    expect(f.error).toBe("not_erc20");
  });
});
