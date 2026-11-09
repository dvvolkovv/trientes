import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import { chainMismatches, readChainFacts, syncChainFacts } from "../src/lib/coin-card-chain-facts";

const GENESIS = `0x${"ab".repeat(32)}`;

/** Поддельный Substrate-узел с управляемой скоростью и высотой цепи. */
function node(
  opts: {
    decimals?: number;
    symbol?: string;
    prefix?: number | null;
    best?: number;
    finalized?: number;
    stepMs?: number;
    genesis?: string;
    txVersion?: number;
    feePlanck?: string;
    feeFails?: boolean;
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
        ss58Format: opts.prefix === undefined ? 10960 : opts.prefix,
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
    } else if (method === "state_getRuntimeVersion") {
      result = {
        specName: "taler",
        specVersion: 12,
        transactionVersion: opts.txVersion ?? 2,
      };
    } else if (method === "payment_queryInfo") {
      if (opts.feeFails) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ error: { message: "Unable to query dispatch info." } }),
        };
      }
      result = { partialFee: opts.feePlanck ?? "2633280" };
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

  it("пустая записанная идентичность не считается переездом узла", async () => {
    // Живой случай Neutron: первое чтение сорвалось, строка фактов осталась с
    // пустым chain-id. Со строгим сравнением карточка застревала в
    // genesis_mismatch навсегда — ни одно следующее чтение не могло записаться.
    const { prisma, upserts } = prismaWith({
      ...talerCard,
      chainFacts: { genesisHash: null },
    });

    const stats = await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: node(),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 1, failed: 0 });
    const written = (upserts[0] as { update: Record<string, unknown> }).update;
    expect(written.checkError).toBeNull();
    expect(written.blockSeconds).toBe(6);
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

describe("комиссия перевода (слайс T)", () => {
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

  const card = {
    id: "card1",
    nativeChain: "taler",
    symbol: "TAL",
    tokenomics: {},
    payments: {},
    provenance: {},
    chainFacts: null,
    priceIndex: null as { priceUsd: number } | null,
  };

  const run = (prisma: unknown, fetchImpl: FetchLike) =>
    syncChainFacts({
      prisma: prisma as never,
      fetchImpl,
      now: new Date("2026-11-07T10:00:00Z"),
    });

  it("читает комиссию и переводит её в монеты", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node() });
    expect(f.transferFeePlanck).toBe("2633280");
    expect(f.transferFeeTokens).toBeCloseTo(0.00000263328, 12);
    expect(f.transferFeeError).toBeNull();
  });

  it("версия транзакций разошлась с пришпиленной — комиссия неизвестна, факты на месте", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node({ txVersion: 3 }) });
    expect(f.transferFeeError).toBe("runtime_changed");
    expect(f.transferFeePlanck).toBeNull();
    expect(f.blockSeconds).toBe(6);
    expect(f.error).toBeNull();
  });

  it("узел не посчитал комиссию — остальные факты сохраняются", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node({ feeFails: true }) });
    expect(f.transferFeeError).toBe("decode_failed");
    expect(f.blockSeconds).toBe(6);
    expect(f.error).toBeNull();
  });

  it("нулевая комиссия — это ноль, а не отсутствие данных", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node({ feePlanck: "0" }) });
    expect(f.transferFeePlanck).toBe("0");
    expect(f.transferFeeTokens).toBe(0);
  });

  it("прогон пишет комиссию в факты сети", async () => {
    const { prisma, upserts } = prismaWith({ ...card });
    await run(prisma, node());
    expect((upserts[0] as { create: Record<string, unknown> }).create).toMatchObject({
      transferFeePlanck: "2633280",
      transferFeeError: null,
    });
  });

  it("без индекса цены комиссия в USD не считается и провенанс не ставится", async () => {
    const { prisma, updates } = prismaWith({
      ...card,
      payments: { feeUsdTypical: 0.01 },
      priceIndex: null,
    });
    await run(prisma, node());
    const prov = (updates[0] as { data: { provenance: Record<string, unknown> } }).data.provenance;
    expect(prov["payments.feeUsdTypical"]).toBeUndefined();
  });

  it("заявленная комиссия вчетверо выше проверенной — расхождение FEE_USD", async () => {
    // Факт: 0,00000263328 TAL × $4000 = $0,0105. Заявлено $0,05 — разница
    // больше и 10 %, и цента.
    const { prisma, upserts, updates } = prismaWith({
      ...card,
      payments: { feeUsdTypical: 0.05 },
      priceIndex: { priceUsd: 4000 },
    });
    await run(prisma, node());
    const create = (upserts[0] as { create: { mismatches: string[] } }).create;
    expect(create.mismatches).toContain("FEE_USD");
    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string }> } }).data
      .provenance;
    expect(prov["payments.feeUsdTypical"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("разница в доли цента расхождением не считается", async () => {
    // Факт $0,0105 против заявленных $0,015: относительная разница велика, но
    // в абсолютных деньгах это полцента — шум, а не обман.
    const { prisma, upserts } = prismaWith({
      ...card,
      payments: { feeUsdTypical: 0.015 },
      priceIndex: { priceUsd: 4000 },
    });
    await run(prisma, node());
    expect((upserts[0] as { create: { mismatches: string[] } }).create.mismatches).toEqual([]);
  });

  it("заявленная комиссия в пределах десяти процентов — расхождения нет", async () => {
    const { prisma, upserts } = prismaWith({
      ...card,
      payments: { feeUsdTypical: 0.011 },
      priceIndex: { priceUsd: 4000 },
    });
    await run(prisma, node());
    expect((upserts[0] as { create: { mismatches: string[] } }).create.mismatches).toEqual([]);
  });
});

describe("сеть без читаемой комиссии (слайс V)", () => {
  // У HydraDX не совпал набор подписанных расширений, у Moonbeam адреса
  // 20-байтные: индекс палеты в реестре `null`, и комиссия честно не читается.
  // Остальные факты сети при этом обязаны прочитаться.
  it.each(["hydradx", "moonbeam", "moonriver"])(
    "%s: комиссия fee_unsupported, прочие факты на месте",
    async (chain) => {
      const facts = await readChainFacts({ chain, fetchImpl: node({}) });
      expect(facts.error).toBeNull();
      expect(facts.transferFeeError).toBe("fee_unsupported");
      expect(facts.transferFeePlanck).toBeNull();
      expect(facts.blockSeconds).toBeGreaterThan(0);
      expect(facts.genesisHash).toBeTruthy();
    },
  );

  it("узел не публикует префикс SS58 — расхождения нет", async () => {
    const facts = await readChainFacts({ chain: "hydradx", fetchImpl: node({ prefix: null }) });
    const codes = chainMismatches({
      chainKey: "hydradx",
      cardSymbol: facts.tokenSymbol ?? "",
      claimedDecimals: null,
      facts: {
        symbol: facts.tokenSymbol,
        decimals: facts.tokenDecimals,
        ss58Format: facts.ss58Format,
      },
    });
    expect(codes).not.toContain("SS58_FORMAT");
  });
});

describe("семья Cosmos (слайс V)", () => {
  /** Поддельный REST-узел Cosmos: тот же инъектируемый fetch, но GET. */
  function cosmos(
    opts: { chainId?: string; height?: number; stepMs?: number; meta?: boolean } = {},
  ): FetchLike {
    const height = opts.height ?? 15_724_506;
    const base = Date.parse("2026-11-09T05:18:11.095Z");
    const step = opts.stepMs ?? 11_500;
    return (async (url: string) => {
      const json = (body: unknown, ok = true, status = 200) => ({
        ok,
        status,
        json: async () => body,
      });
      if (url.includes("/blocks/")) {
        const raw = url.split("/blocks/")[1];
        const h = raw === "latest" ? height : Number(raw);
        return json({
          block: {
            header: {
              chain_id: opts.chainId ?? "celestia",
              height: String(h),
              time: new Date(base - (height - h) * step).toISOString(),
            },
          },
        });
      }
      if (url.includes("/denoms_metadata/")) {
        if (opts.meta === false) return json({ code: 5, message: "client metadata" }, false, 404);
        return json({
          metadata: {
            display: "TIA",
            denom_units: [
              { denom: "utia", exponent: 0 },
              { denom: "TIA", exponent: 6 },
            ],
          },
        });
      }
      if (url.includes("/node/v1beta1/config")) {
        return json({ minimum_gas_price: "0.002000000000000000utia" });
      }
      return json({ code: 12, message: "not implemented" }, false, 501);
    }) as unknown as FetchLike;
  }

  it("читает chain-id, время блока, цену газа; финальность — в том же блоке", async () => {
    const facts = await readChainFacts({ chain: "celestia", fetchImpl: cosmos(), sample: 200 });
    expect(facts.error).toBeNull();
    expect(facts.family).toBe("COSMOS");
    expect(facts.chainId).toBe("celestia");
    // Хэш генезиса у этой семьи не читается: блок 1 на обрезанных узлах нет.
    expect(facts.genesisHash).toBeNull();
    expect(facts.blockSeconds).toBe(11.5);
    expect(facts.finalityLag).toBe(0);
    expect(facts.finalitySeconds).toBe(0);
    expect(facts.minGasPrice).toBe("0.002");
    expect(facts.tokenSymbol).toBe("TIA");
    expect(facts.tokenDecimals).toBe(6);
    // Комиссию перевода этой семье пока никто не считает — и это сказано явно.
    expect(facts.transferFeeError).toBe("fee_unsupported");
    expect(facts.transferFeeTokens).toBeNull();
    expect(facts.ss58Format).toBeNull();
  });

  it("сеть без реестра денома: тикер и знаки пустые, остальное на месте", async () => {
    const facts = await readChainFacts({ chain: "celestia", fetchImpl: cosmos({ meta: false }) });
    expect(facts.error).toBeNull();
    expect(facts.tokenSymbol).toBeNull();
    expect(facts.tokenDecimals).toBeNull();
    expect(facts.chainId).toBe("celestia");
  });

  it("узел представился другой цепью — CHAIN_ID в расхождениях", () => {
    expect(
      chainMismatches({
        chainKey: "celestia",
        cardSymbol: "TIA",
        claimedDecimals: null,
        facts: { symbol: "TIA", decimals: 6, ss58Format: null, chainId: "celestia-test" },
      }),
    ).toContain("CHAIN_ID");
  });

  it("свой chain-id расхождением не считается", () => {
    expect(
      chainMismatches({
        chainKey: "celestia",
        cardSymbol: "TIA",
        claimedDecimals: null,
        facts: { symbol: "TIA", decimals: 6, ss58Format: null, chainId: "celestia" },
      }),
    ).toEqual([]);
  });

  it("переезд ловится по chain-id, а не по хэшу генезиса", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [
          {
            id: "card1",
            nativeChain: "celestia",
            symbol: "TIA",
            tokenomics: {},
            payments: {},
            provenance: {},
            chainFacts: { genesisHash: null, chainId: "celestia-old" },
            priceIndex: null,
          },
        ],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardChainFacts: {
        upsert: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
    };
    const stats = await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: cosmos(),
      now: new Date("2026-11-09T10:00:00Z"),
    });
    expect(stats).toEqual({ cards: 1, ok: 0, failed: 1 });
    const written = updates[0] as { update: Record<string, unknown> };
    expect(written.update.checkError).toBe("genesis_mismatch");
    // Числа не перезаписаны: в update ушли только отметка времени и ошибка.
    expect(Object.keys(written.update).sort()).toEqual(["checkError", "checkedAt"]);
  });
});

describe("застрявшая финализация (слайс V)", () => {
  it("отставание больше часа — секунд финализации нет, числа голов остаются", async () => {
    // Живой прогон 9 ноября: публичный узел Astar отдал лучшую голову на 9810
    // блоков впереди финализированной. Умножение дало бы «финализация 17 часов»
    // — это состояние узла в тот миг, а не свойство сети.
    const f = await readChainFacts({
      chain: "astar",
      fetchImpl: node({ best: 1_000_100, finalized: 1_000_100 - 9810 }),
    });
    expect(f.error).toBeNull();
    expect(f.finalityLag).toBe(9810);
    expect(f.finalitySeconds).toBeNull();
    expect(f.bestNumber).toBe(1_000_100);
    expect(f.finalizedNumber).toBe(1_000_100 - 9810);
  });

  it("отставание в пределах порога считается как раньше", async () => {
    const f = await readChainFacts({
      chain: "astar",
      fetchImpl: node({ best: 1_000_100, finalized: 1_000_000 }),
    });
    expect(f.finalityLag).toBe(100);
    expect(f.finalitySeconds).toBe(600);
  });

  it("при застрявшей финализации провенанс её не помечает проверенной", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [
          {
            id: "card1",
            nativeChain: "astar",
            symbol: "ASTR",
            tokenomics: {},
            provenance: {},
            chainFacts: null,
          },
        ],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardChainFacts: { upsert: async () => ({}) },
    };

    await syncChainFacts({
      prisma: prisma as never,
      fetchImpl: node({ best: 1_000_100, finalized: 1_000_100 - 9810 }),
    });

    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string }> } }).data
      .provenance;
    expect(prov["payments.blockSeconds"].kind).toBe("VERIFIED_ONCHAIN");
    expect(prov["payments.finalitySeconds"]).toBeUndefined();
  });
});

describe("семья Bitcoin (слайс Y)", () => {
  const GENESIS_BTC = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";
  const CHECKPOINT_BTC = "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054";
  const GENESIS_DOGE = "1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691";

  /**
   * Поддельный узел Esplora: тот же инъектируемый fetch, но ответы читаются
   * через text() — высота головы приходит голым числом.
   */
  function esplora(
    opts: {
      height?: number;
      stepMs?: number;
      genesis?: string;
      checkpoint?: string;
      feePerVb?: number;
      noFees?: boolean;
    } = {},
  ): FetchLike {
    const height = opts.height ?? 975_185;
    const base = Date.parse("2026-11-09T14:30:00Z");
    const step = opts.stepMs ?? 600_000;
    const hashAt = (h: number) =>
      h === 0
        ? (opts.genesis ?? GENESIS_BTC)
        : h === 800_000
          ? (opts.checkpoint ?? CHECKPOINT_BTC)
          : h.toString(16).padStart(64, "0");

    return (async (url: string) => {
      const text = (body: string, status = 200) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
      });
      if (url.endsWith("/blocks/tip/height")) return text(String(height));
      if (url.includes("/block-height/")) return text(hashAt(Number(url.split("/block-height/")[1])));
      if (url.includes("/block/")) {
        const hash = url.split("/block/")[1];
        const h =
          hash === (opts.genesis ?? GENESIS_BTC)
            ? 0
            : hash === (opts.checkpoint ?? CHECKPOINT_BTC)
              ? 800_000
              : parseInt(hash, 16);
        return text(
          JSON.stringify({ id: hash, height: h, timestamp: Math.floor((base - (height - h) * step) / 1000) }),
        );
      }
      if (url.endsWith("/v1/fees/recommended")) {
        if (opts.noFees) return text('endpoint does not exist "/v1/fees/recommended"', 404);
        return text(JSON.stringify({ halfHourFee: opts.feePerVb ?? 2 }));
      }
      if (url.endsWith("/fee-estimates")) {
        if (opts.noFees) return text('endpoint does not exist "/fee-estimates"', 404);
        return text(JSON.stringify({ "6": opts.feePerVb ?? 2 }));
      }
      return text("not found", 404);
    }) as unknown as FetchLike;
  }

  /** Поддельный узел BlockCypher: Dogecoin и Dash читаются им. */
  function blockcypher(opts: { height?: number; stepMs?: number; genesis?: string } = {}): FetchLike {
    const height = opts.height ?? 6_450_537;
    const base = Date.parse("2026-11-09T14:38:24Z");
    const step = opts.stepMs ?? 60_000;
    const hashAt = (h: number) =>
      h === 0 ? (opts.genesis ?? GENESIS_DOGE) : h.toString(16).padStart(64, "0");

    return (async (url: string) => {
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body });
      if (url.includes("/blocks/")) {
        const h = Number(url.split("/blocks/")[1]);
        return text(
          JSON.stringify({
            hash: hashAt(h),
            height: h,
            time: new Date(base - (height - h) * step).toISOString(),
          }),
        );
      }
      return text(
        JSON.stringify({
          name: "DOGE.main",
          height,
          hash: hashAt(height),
          time: new Date(base).toISOString(),
          medium_fee_per_kb: 62_345_835,
        }),
      );
    }) as unknown as FetchLike;
  }

  it("читает генезис, время блока и комиссию; финализации в PoW нет", async () => {
    const facts = await readChainFacts({ chain: "bitcoin", fetchImpl: esplora({ feePerVb: 2 }) });
    expect(facts.error).toBeNull();
    expect(facts.family).toBe("BITCOIN");
    expect(facts.genesisHash).toBe(GENESIS_BTC);
    expect(facts.blockSeconds).toBe(600);
    expect(facts.blockSample).toBe(100);
    expect(facts.bestNumber).toBe(975_185);
    // Окончательность в PoW не достигается: выдавать соглашение получателя за
    // измеренный факт нельзя.
    expect(facts.finalizedNumber).toBeNull();
    expect(facts.finalityLag).toBeNull();
    expect(facts.finalitySeconds).toBeNull();
    // Комиссия: 2 sat/vB × 141 vB = 282 сатоши.
    expect(facts.transferFeePlanck).toBe("282");
    expect(facts.transferFeeTokens).toBeCloseTo(0.00000282, 12);
    expect(facts.transferFeeError).toBeNull();
    // Тикер и знаки из этих API не читаются — и не подставляются из реестра.
    expect(facts.tokenSymbol).toBeNull();
    expect(facts.tokenDecimals).toBeNull();
    expect(facts.chainId).toBeNull();
  });

  it("BlockCypher: Dogecoin читается по цене за килобайт и legacy-размеру", async () => {
    const facts = await readChainFacts({ chain: "dogecoin", fetchImpl: blockcypher() });
    expect(facts.error).toBeNull();
    expect(facts.genesisHash).toBe(GENESIS_DOGE);
    expect(facts.blockSeconds).toBe(60);
    // 62 345 835 / 1000 × 226 vB, округление вверх до сатоши.
    expect(facts.transferFeePlanck).toBe("14090159");
    expect(facts.transferFeeTokens).toBeCloseTo(0.14090159, 10);
  });

  it("узел отвечает за форк — genesis_mismatch, числа не пишутся", async () => {
    // Хэш блока 0 у Bitcoin Cash тот же, что у Bitcoin: отличает только блок
    // выше точки форка.
    const facts = await readChainFacts({
      chain: "bitcoin",
      fetchImpl: esplora({ checkpoint: "f".repeat(64) }),
    });
    expect(facts.error).toBe("genesis_mismatch");
    expect(facts.blockSeconds).toBeNull();
    expect(facts.transferFeePlanck).toBeNull();
  });

  it("чужой генезис — тоже genesis_mismatch", async () => {
    const facts = await readChainFacts({
      chain: "litecoin",
      fetchImpl: esplora({ genesis: "a".repeat(64) }),
    });
    expect(facts.error).toBe("genesis_mismatch");
  });

  it("узел не дал оценки комиссии — остальные факты на месте", async () => {
    const facts = await readChainFacts({ chain: "bitcoin", fetchImpl: esplora({ noFees: true }) });
    expect(facts.error).toBeNull();
    expect(facts.transferFeeError).toBe("fee_unsupported");
    expect(facts.transferFeePlanck).toBeNull();
    expect(facts.blockSeconds).toBeGreaterThan(0);
    expect(facts.genesisHash).toBeTruthy();
  });

  it("переезд ловится по хэшу генезиса, как у Substrate", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [
          {
            id: "card1",
            nativeChain: "bitcoin",
            symbol: "BTC",
            tokenomics: {},
            payments: {},
            provenance: {},
            chainFacts: { genesisHash: "b".repeat(64), chainId: null },
            priceIndex: null,
          },
        ],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardChainFacts: {
        upsert: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
    };
    const stats = await syncChainFacts({ prisma: prisma as never, fetchImpl: esplora() });
    expect(stats).toEqual({ cards: 1, ok: 0, failed: 1 });
    expect((updates[0] as { update: { checkError: string } }).update.checkError).toBe(
      "genesis_mismatch",
    );
  });

  it("провенанс: время блока проверено, финализация — нет", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [
          {
            id: "card1",
            nativeChain: "bitcoin",
            symbol: "BTC",
            tokenomics: {},
            payments: {},
            provenance: {},
            chainFacts: null,
            priceIndex: { priceUsd: 74_554 },
          },
        ],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardChainFacts: { upsert: async () => ({}) },
    };
    await syncChainFacts({ prisma: prisma as never, fetchImpl: esplora() });
    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string }> } }).data
      .provenance;
    expect(prov["payments.blockSeconds"].kind).toBe("VERIFIED_ONCHAIN");
    expect(prov["payments.finalitySeconds"]).toBeUndefined();
    // Комиссия в долларах подтверждается: цена монеты известна.
    expect(prov["payments.feeUsdTypical"].kind).toBe("VERIFIED_ONCHAIN");
    // Тикер и знаки не прочитаны — проверенными не помечены.
    expect(prov["chain.symbol"]).toBeUndefined();
    expect(prov["chain.decimals"]).toBeUndefined();
  });
});
