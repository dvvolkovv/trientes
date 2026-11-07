import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import { chainMismatches, readChainFacts, syncChainFacts } from "../src/lib/coin-card-chain-facts";

const GENESIS = `0x${"ab".repeat(32)}`;

/** Поддельный Substrate-узел с управляемой скоростью и высотой цепи. */
function node(
  opts: {
    decimals?: number;
    symbol?: string;
    prefix?: number;
    best?: number;
    finalized?: number;
    stepMs?: number;
    genesis?: string;
  } = {},
): FetchLike {
  const best = opts.best ?? 1_000_100;
  const finalized = opts.finalized ?? best - 2;
  const step = opts.stepMs ?? 6000;
  const le = (v: bigint, bytes: number) =>
    `0x${Array.from({ length: bytes }, (_, i) =>
      Number((v >> BigInt(8 * i)) & BigInt(0xff))
        .toString(16)
        .padStart(2, "0"),
    ).join("")}`;

  return async (_url, init) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    let result: unknown = null;
    if (method === "system_properties") {
      result = {
        ss58Format: opts.prefix ?? 10960,
        tokenDecimals: opts.decimals ?? 12,
        tokenSymbol: opts.symbol ?? "TAL",
      };
    } else if (method === "chain_getBlockHash") {
      result = params[0] === 0 ? (opts.genesis ?? GENESIS) : `0xblock${String(params[0])}`;
    } else if (method === "chain_getHeader") {
      const n = params.length === 0 ? best : finalized;
      result = { number: `0x${n.toString(16)}` };
    } else if (method === "chain_getFinalizedHead") {
      result = "0xfinalized";
    } else if (method === "state_getStorageAt") {
      const number = Number(String(params[1]).replace("0xblock", ""));
      result = le(BigInt(1_700_000_000_000 + number * step), 8);
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("chainMismatches", () => {
  it("сходится — расхождений нет", () => {
    expect(
      chainMismatches({
        chainKey: "taler",
        cardSymbol: "TAL",
        claimedDecimals: 12,
        facts: { symbol: "TAL", decimals: 12, ss58Format: 10960 },
      }),
    ).toEqual([]);
  });

  it("различает расхождение с карточкой и расхождение с реестром", () => {
    expect(
      chainMismatches({
        chainKey: "taler",
        cardSymbol: "TAL",
        claimedDecimals: 8,
        facts: { symbol: "XYZ", decimals: 12, ss58Format: 1 },
      }).sort(),
    ).toEqual(["CHAIN_SYMBOL", "DECIMALS", "SS58_FORMAT", "SYMBOL"].sort());
  });

  it("незаявленные знаки расхождением не считаются", () => {
    expect(
      chainMismatches({
        chainKey: "taler",
        cardSymbol: "TAL",
        claimedDecimals: null,
        facts: { symbol: "TAL", decimals: 12, ss58Format: 10960 },
      }),
    ).toEqual([]);
  });

  it("регистр тикера роли не играет", () => {
    expect(
      chainMismatches({
        chainKey: "taler",
        cardSymbol: "tal",
        claimedDecimals: null,
        facts: { symbol: "TAL", decimals: 12, ss58Format: 10960 },
      }),
    ).toEqual([]);
  });
});

describe("readChainFacts", () => {
  it("собирает свойства, генезис, время блока и отставание финализации", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node() });
    expect(f.error).toBeNull();
    expect(f.genesisHash).toBe(GENESIS);
    expect(f.tokenSymbol).toBe("TAL");
    expect(f.tokenDecimals).toBe(12);
    expect(f.ss58Format).toBe(10960);
    expect(f.blockSeconds).toBe(6);
    expect(f.bestNumber).toBe(1_000_100);
    expect(f.finalityLag).toBe(2);
    expect(f.finalitySeconds).toBe(12);
  });

  it("сеть не из реестра — chain_unsupported, числа пустые", async () => {
    const f = await readChainFacts({ chain: "solana", fetchImpl: node() });
    expect(f.error).toBe("chain_unsupported");
    expect(f.blockSeconds).toBeNull();
  });

  it("недоступный узел — rpc_unreachable", async () => {
    const f = await readChainFacts({
      chain: "taler",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(f.error).toBe("rpc_unreachable");
    expect(f.blockSeconds).toBeNull();
  });

  it("молодая цепь короче выборки — замер по тому, что есть", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node({ best: 40 }), sample: 100 });
    expect(f.error).toBeNull();
    expect(f.blockSeconds).toBe(6);
    expect(f.blockSample).toBe(39);
  });
});

describe("syncChainFacts", () => {
  function prismaWith(card: Record<string, unknown>) {
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [card],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardChainFacts: {
        upsert: async (a: Record<string, unknown>) => {
          upserts.push(a);
          return {};
        },
      },
    };
    return { prisma, upserts, updates };
  }

  const talerCard = {
    id: "card1",
    nativeChain: "taler",
    symbol: "TAL",
    tokenomics: {},
    provenance: {},
    chainFacts: null,
  };

  it("пишет факты и провенанс платёжных полей", async () => {
    const { prisma, upserts, updates } = prismaWith({ ...talerCard });

    const stats = await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: node(),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 1, failed: 0 });
    const create = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(create).toMatchObject({
      chain: "taler",
      genesisHash: GENESIS,
      tokenSymbol: "TAL",
      tokenDecimals: 12,
      blockSeconds: 6,
      finalityLag: 2,
      finalitySeconds: 12,
      mismatches: [],
      checkError: null,
    });

    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string }> } }).data
      .provenance;
    expect(prov["payments.blockSeconds"].kind).toBe("VERIFIED_ONCHAIN");
    expect(prov["payments.finalitySeconds"].kind).toBe("VERIFIED_ONCHAIN");
    expect(prov["chain.symbol"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("сменившийся хэш генезиса — genesis_mismatch, числа не перезаписываются", async () => {
    const { prisma, upserts, updates } = prismaWith({
      ...talerCard,
      chainFacts: { genesisHash: `0x${"cd".repeat(32)}` },
    });

    const stats = await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: node(),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 0, failed: 1 });
    const update = (upserts[0] as { update: Record<string, unknown> }).update;
    expect(update.checkError).toBe("genesis_mismatch");
    expect(update.blockSeconds).toBeUndefined();
    // Провенанс тоже не трогаем: нечего подтверждать.
    expect(updates).toEqual([]);
  });

  it("тикер сети расходится с карточкой — факт пишется, расхождение помечено", async () => {
    const { prisma, upserts } = prismaWith({ ...talerCard, symbol: "WRONG" });

    await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: node(),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    const create = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(create.mismatches).toEqual(["SYMBOL"]);
    expect(create.checkError).toBeNull();
  });
});
