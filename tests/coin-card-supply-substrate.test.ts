import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  parseExcluded,
  pickAggregated,
  readSubstrateSupplyFacts,
  supplyShare,
  syncCardSupply,
} from "../src/lib/coin-card-supply";

// Адрес Alice в формате Polkadot (префикс 0) — им проверяется ветка Substrate.
const ALICE = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
const GENESIS = `0x${"ab".repeat(32)}`;

const le = (v: bigint, bytes: number) =>
  `0x${Array.from({ length: bytes }, (_, i) =>
    Number((v >> BigInt(8 * i)) & BigInt(0xff))
      .toString(16)
      .padStart(2, "0"),
  ).join("")}`;

function accountInfo(coins: bigint, decimals: number): string {
  const units = coins * BigInt(10) ** BigInt(decimals);
  const b = new Uint8Array(80);
  for (let i = 0; i < 16; i++) b[16 + i] = Number((units >> BigInt(8 * i)) & BigInt(0xff));
  return `0x${Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Поддельный Substrate-узел: 12 знаков, заданный выпуск и один счёт. */
function chainNode(totalCoins: bigint, excludedCoins: bigint): FetchLike {
  const issuance = totalCoins * BigInt(10) ** BigInt(12);
  return async (_url, init) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    let result: unknown = null;
    if (method === "system_properties") {
      result = { ss58Format: 0, tokenDecimals: 12, tokenSymbol: "TAL" };
    } else if (method === "chain_getBlockHash") {
      result = GENESIS;
    } else if (method === "state_getStorage") {
      // Ключ общего выпуска — 32 байта; ключ счёта длиннее на хеш и сам ключ.
      result = String(params[0]).length === 66 ? le(issuance, 16) : accountInfo(excludedCoins, 12);
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("parseExcluded с валидатором адреса", () => {
  const tokenomics = {
    excluded: [
      { address: `0x${"1".repeat(40)}`, label: "казна" },
      { address: ALICE, label: "ss58" },
    ],
  };

  it("по умолчанию берёт только EVM-адреса и два адреса сжигания", () => {
    expect(parseExcluded(tokenomics).map((e) => e.label)).toEqual(["казна", "burn", "burn"]);
  });

  it("с валидатором SS58 берёт только адреса своей сети", () => {
    const got = parseExcluded(tokenomics, {
      accept: (a) => a === ALICE,
      normalize: (a) => a,
    });
    expect(got.map((e) => e.label)).toEqual(["ss58"]);
    expect(got[0].address).toBe(ALICE);
  });
});

describe("readSubstrateSupplyFacts", () => {
  it("читает выпуск, знаки, генезис и балансы исключений", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [{ address: ALICE, label: "казна" }],
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(250_000)),
    });
    expect(facts.error).toBeNull();
    expect(facts.decimals).toBe(12);
    expect(facts.symbol).toBe("TAL");
    expect(facts.genesisHash).toBe(GENESIS);
    expect(facts.totalUnits).toBe((BigInt(1_000_000) * BigInt(10) ** BigInt(12)).toString());
    expect(facts.balances[0].units).toBe((BigInt(250_000) * BigInt(10) ** BigInt(12)).toString());
  });

  it("сеть не из реестра — chain_unsupported", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "solana",
      excluded: [],
      fetchImpl: chainNode(BigInt(1), BigInt(0)),
    });
    expect(facts.error).toBe("chain_unsupported");
    expect(facts.totalUnits).toBeNull();
  });

  // Сбой связи, отказ узла и «узел ответил, а значения нет» — три разные
  // новости, и в ночном отчёте здоровья их нельзя путать: первая говорит о
  // публичном узле, последняя — о сети.
  it("недоступный узел — rpc_unreachable", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(facts.error).toBe("rpc_unreachable");
  });

  it("узел ответил 502 — rpc_unreachable", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
    });
    expect(facts.error).toBe("rpc_unreachable");
  });

  it("узел ответил ошибкой JSON-RPC — rpc_error", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "method not found" } }),
      }),
    });
    expect(facts.error).toBe("rpc_error");
  });

  it("узел ответил, а выпуска в ответе нет — decode_failed", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async (_url, init) => {
        const { method } = JSON.parse(init!.body) as { method: string };
        const result =
          method === "system_properties"
            ? { ss58Format: 0, tokenDecimals: 12, tokenSymbol: "DOT" }
            : method === "chain_getBlockHash"
              ? GENESIS
              : null; // выпуск: узел отвечает, значения нет
        return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
      },
    });
    expect(facts.error).toBe("decode_failed");
  });
});

describe("syncCardSupply для нативной сети", () => {
  function prismaWith(card: Record<string, unknown>) {
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async (args: { where: { supply?: { is?: null } } }) =>
          args.where.supply?.is === null ? [card] : [],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardSupply: {
        upsert: async (a: Record<string, unknown>) => {
          upserts.push(a);
          return {};
        },
      },
    };
    return { prisma, upserts, updates };
  }

  it("считает оборот, помечает метод SUBSTRATE_V1 и провенанс", async () => {
    const { prisma, upserts, updates } = prismaWith({
      id: "card1",
      nativeChain: "polkadot",
      tokenomics: { excluded: [{ address: ALICE, label: "казна" }], circulating: 750000 },
      provenance: {},
      contracts: [],
      supply: null,
    });

    const stats = await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(250_000)),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 1, partial: 0, failed: 0, unsupported: 0 });
    const data = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(data.method).toBe("SUBSTRATE_V1");
    expect(data.chain).toBe("polkadot");
    expect(data.address).toBe(GENESIS);
    expect(data.decimals).toBe(12);
    expect(data.totalSupply).toBe("1000000");
    expect(data.excludedTotal).toBe("250000");
    expect(data.circulating).toBe("750000");
    expect(data.claimedDeltaPct).toBe(0);

    const prov = (
      updates[0] as { data: { provenance: Record<string, { kind: string; source: string }> } }
    ).data.provenance;
    expect(prov["supply.circulating"]).toMatchObject({
      kind: "VERIFIED_ONCHAIN",
      source: "polkadot",
    });
  });

  it("адреса сжигания EVM к Substrate не применяются", async () => {
    const { prisma, upserts } = prismaWith({
      id: "card1",
      nativeChain: "polkadot",
      // Нулевой адрес EVM в Substrate не адрес вовсе: он не должен ни
      // вычитаться, ни попадать в расчёт как «не ответил».
      tokenomics: { excluded: [{ address: `0x${"0".repeat(40)}`, label: "сжигание" }] },
      provenance: {},
      contracts: [],
      supply: null,
    });

    await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(250_000)),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    const data = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(data.excludedTotal).toBe("0");
    expect(data.circulating).toBe("1000000");
    expect(data.excluded).toEqual([]);
    expect(data.partial).toBe(false);
  });

  it("сеть не из реестра — ошибка в строке выпуска, прошлые числа целы", async () => {
    const { prisma, upserts } = prismaWith({
      id: "card1",
      nativeChain: "mystery",
      tokenomics: {},
      provenance: {},
      contracts: [],
      supply: null,
    });

    const stats = await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1), BigInt(0)),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 0, partial: 0, failed: 1, unsupported: 0 });
    const upsert = upserts[0] as { update: Record<string, unknown> };
    expect(upsert.update.checkError).toBe("chain_unsupported");
    expect(upsert.update.totalSupply).toBeUndefined();
  });
});

describe("сорванное чтение не стирает прочитанное раньше", () => {
  function prismaWith(card: Record<string, unknown>) {
    const upserts: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async (args: { where: { supply?: { is?: null } } }) =>
          args.where.supply?.is === null ? [card] : [],
        update: async () => ({}),
      },
      coinCardSupply: {
        upsert: async (a: Record<string, unknown>) => {
          upserts.push(a);
          return {};
        },
      },
    };
    return { prisma, upserts };
  }

  // Недоступный узел — не новость о монете: знаки после точки и хэш генезиса
  // в строке выпуска остаются теми, что сеть уже подтвердила. Иначе один
  // сетевой сбой обнуляет знаки, а с ними и порядок величины выпуска.
  it("знаки и хэш генезиса не обнуляются сбоем узла", async () => {
    const { prisma, upserts } = prismaWith({
      id: "card1",
      nativeChain: "polkadot",
      tokenomics: {},
      provenance: {},
      contracts: [],
      supply: null,
    });

    await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      now: new Date("2026-11-10T10:00:00Z"),
    });

    const upsert = upserts[0] as { update: Record<string, unknown>; create: Record<string, unknown> };
    expect(upsert.update.checkError).toBe("rpc_unreachable");
    expect(upsert.update.decimals).toBeUndefined();
    expect(upsert.update.address).toBeUndefined();
    // Строки у карточки ещё нет — её нужно чем-то создать, и вот там нули уместны.
    expect(upsert.create.decimals).toBe(0);
    expect(upsert.create.address).toBe("");
  });
});

describe("выпуск читается с того узла, где он лежит", () => {
  /** Запоминает адреса, на которые ушли запросы. */
  function recordingNode(seen: string[]): FetchLike {
    const issuance = BigInt(1_000_000) * BigInt(10) ** BigInt(12);
    return async (url, init) => {
      seen.push(String(url));
      const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
      let result: unknown = null;
      if (method === "system_properties") {
        result = { ss58Format: 0, tokenDecimals: 12, tokenSymbol: "DOT" };
      } else if (method === "chain_getBlockHash") {
        result = GENESIS;
      } else if (method === "state_getStorage") {
        result = String(params[0]).length === 66 ? le(issuance, 16) : accountInfo(BigInt(0), 12);
      }
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
    };
  }

  // Балансы Polkadot переехали в Asset Hub, и на релее остался остаток: выпуск
  // обязан читаться с того узла, где он настоящий.
  it("у Polkadot общий выпуск спрашивается у Asset Hub, остальное — у релея", async () => {
    const seen: string[] = [];
    await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [{ address: ALICE, label: "казна" }],
      fetchImpl: recordingNode(seen),
    });
    expect(seen).toContain("https://polkadot-asset-hub-rpc.polkadot.io");
    expect(seen).toContain("https://rpc.polkadot.io");
  });

  it("у сети без переезда все запросы идут на один узел", async () => {
    const seen: string[] = [];
    await readSubstrateSupplyFacts({ chain: "taler", excluded: [], fetchImpl: recordingNode(seen) });
    expect(new Set(seen)).toEqual(new Set(["https://node.taler.uno"]));
  });
});

describe("supplyShare", () => {
  it("доля прочитанного выпуска от заявленного агрегатором", () => {
    expect(supplyShare("210696", 1_000_000_000)).toBeCloseTo(0.00021, 5);
    expect(supplyShare("600000", 1_000_000)).toBeCloseTo(0.6, 5);
    expect(supplyShare("1000000", 1_000_000)).toBe(1);
    // Прочитано больше заявленного — это не повод скрывать факт: охранник
    // ловит только недостачу.
    expect(supplyShare("2000000", 1_000_000)).toBe(2);
  });

  it("сравнивать не с чем — доли нет", () => {
    expect(supplyShare("1000", null)).toBeNull();
    expect(supplyShare("1000", 0)).toBeNull();
    expect(supplyShare(null, 1000)).toBeNull();
  });
});

describe("охранник доли выпуска", () => {
  function prismaWith(card: Record<string, unknown>, snapshot: Record<string, unknown> | null) {
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async (args: { where: { supply?: { is?: null } } }) =>
          args.where.supply?.is === null ? [card] : [],
        update: async (a: Record<string, unknown>) => {
          updates.push(a);
          return {};
        },
      },
      coinCardSupply: {
        upsert: async (a: Record<string, unknown>) => {
          upserts.push(a);
          return {};
        },
      },
      coinSnapshot: { findFirst: async () => snapshot },
    };
    return { prisma, upserts, updates };
  }

  const card = {
    id: "card1",
    coinId: "mantra",
    nativeChain: "polkadot",
    tokenomics: {},
    provenance: {},
    contracts: [],
    supply: null,
  };

  // Случай MANTRA: в собственной сети лежит 0,02 % монеты, остальное живёт
  // снаружи. Такое число нельзя показывать как выпуск монеты.
  it("прочитано в разы меньше заявленного — число есть, но не как выпуск", async () => {
    const { prisma, upserts, updates } = prismaWith(card, { totalSupply: "1000000000" });
    const stats = await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(0)),
      now: new Date("2026-11-09T10:00:00Z"),
    });

    expect(stats.failed).toBe(1);
    const data = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(data.checkError).toBe("supply_share");
    // Само число сохраняется: карточка покажет «в этой сети N, это M % от
    // заявленного» — это полезный факт, просто не выпуск монеты.
    expect(data.totalSupply).toBe("1000000");
    expect(updates).toHaveLength(0);
  });

  it("доля в норме — обычная запись с провенансом", async () => {
    const { prisma, upserts, updates } = prismaWith(card, { totalSupply: "1100000" });
    const stats = await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(0)),
      now: new Date("2026-11-09T10:00:00Z"),
    });

    expect(stats.ok).toBe(1);
    expect((upserts[0] as { create: Record<string, unknown> }).create.checkError).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("снимка агрегатора нет — охранник молчит", async () => {
    const { prisma, upserts } = prismaWith({ ...card, coinId: null }, null);
    await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: chainNode(BigInt(1_000_000), BigInt(0)),
      now: new Date("2026-11-09T10:00:00Z"),
    });
    expect((upserts[0] as { create: Record<string, unknown> }).create.checkError).toBeNull();
  });
});

describe("pickAggregated", () => {
  it("общий выпуск предпочтительнее оборота", () => {
    expect(pickAggregated(1_000_000, 700_000)).toBe(1_000_000);
  });

  it("абсурдный общий выпуск уступает обороту", () => {
    // Живой случай Neutron: 6,2e27 при обороте 369 млн — база в минимальных
    // единицах, попавшая в поле монет. Сравнение с ней объявило бы прочитанные
    // 546 млн NTRN «малой частью монеты».
    expect(pickAggregated(6.219e27, 369_081_858)).toBe(369_081_858);
  });

  it("ноль, отрицательное и NaN числами не считаются", () => {
    expect(pickAggregated(0, 692_773_334)).toBe(692_773_334);
    expect(pickAggregated(NaN, 100)).toBe(100);
    expect(pickAggregated(-5, null)).toBeNull();
    expect(pickAggregated(null, null)).toBeNull();
  });
});
