import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  parseExcluded,
  readSubstrateSupplyFacts,
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

  it("недоступный узел — supply_unreadable", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(facts.error).toBe("supply_unreadable");
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

    expect(stats).toEqual({ cards: 1, ok: 1, partial: 0, failed: 0 });
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

    expect(stats).toEqual({ cards: 1, ok: 0, partial: 0, failed: 1 });
    const upsert = upserts[0] as { update: Record<string, unknown> };
    expect(upsert.update.checkError).toBe("chain_unsupported");
    expect(upsert.update.totalSupply).toBeUndefined();
  });
});
