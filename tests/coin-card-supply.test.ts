import { describe, it, expect } from "vitest";
import { SELECTORS, encodeAddressArg } from "../src/lib/evm-abi";
import type { FetchLike } from "../src/lib/evm-rpc";
import {
  BURN_ADDRESSES,
  MAX_EXCLUDED,
  claimedDeltaPct,
  computeSupply,
  fdv,
  marketCap,
  parseExcluded,
  readSupplyFacts,
  syncCardSupply,
  unitsToCoins,
  type PrismaLike,
} from "../src/lib/coin-card-supply";

describe("unitsToCoins", () => {
  it("сдвигает точку на 18 знаков без потери старших разрядов", () => {
    expect(unitsToCoins("420000000000000000000", 18)).toBe("420");
  });

  it("при нуле знаков возвращает число как есть", () => {
    expect(unitsToCoins("21000000", 0)).toBe("21000000");
  });

  it("не теряет точность на максимуме uint256", () => {
    const max = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
    // 115792089237316195423570985008687907853269984665640564039457.584007913129639935
    expect(unitsToCoins(max, 18)).toBe(
      "115792089237316195423570985008687907853269984665640564039457.584007",
    );
  });

  it("обрезает дробный хвост до шести знаков и убирает хвостовые нули", () => {
    expect(unitsToCoins("1500000000000000000", 18)).toBe("1.5");
    // Обрезка, а не округление: выпуск нельзя завышать даже в седьмом знаке.
    expect(unitsToCoins("1234567891234567891", 18)).toBe("1.234567");
    expect(unitsToCoins("1", 18)).toBe("0");
  });

  it("мусор и невозможные знаки отвергает", () => {
    expect(unitsToCoins("-5", 18)).toBeNull();
    expect(unitsToCoins("0x10", 18)).toBeNull();
    expect(unitsToCoins("", 18)).toBeNull();
    expect(unitsToCoins("100", 256)).toBeNull();
    expect(unitsToCoins("100", -1)).toBeNull();
  });
});

describe("parseExcluded", () => {
  const treasury = "0x" + "1".repeat(40);
  const fund = "0x" + "2".repeat(40);

  it("читает новые строки с подписями", () => {
    const got = parseExcluded({ excluded: [{ address: treasury, label: "Казна" }] });
    expect(got.filter((e) => e.label === "Казна")).toEqual([
      { address: treasury, label: "Казна" },
    ]);
  });

  it("читает старый список строк как адреса без подписи", () => {
    const got = parseExcluded({ excludedAddresses: [treasury, fund] });
    const own = got.filter((e) => !BURN_ADDRESSES.includes(e.address));
    expect(own).toEqual([
      { address: treasury, label: null },
      { address: fund, label: null },
    ]);
  });

  it("смешивает оба источника", () => {
    const got = parseExcluded({
      excluded: [{ address: treasury, label: "Казна" }],
      excludedAddresses: [fund],
    });
    const own = got.filter((e) => !BURN_ADDRESSES.includes(e.address));
    expect(own.map((e) => e.address)).toEqual([treasury, fund]);
  });

  it("всегда добавляет канонические адреса сжигания", () => {
    const got = parseExcluded({});
    expect(got.map((e) => e.address)).toEqual(BURN_ADDRESSES);
    expect(got.every((e) => e.label === "burn")).toBe(true);
  });

  it("схлопывает дубликаты, различающиеся только регистром", () => {
    const got = parseExcluded({
      excluded: [
        { address: treasury.toUpperCase().replace("0X", "0x"), label: "Казна" },
        { address: treasury, label: "Она же" },
      ],
    });
    const own = got.filter((e) => !BURN_ADDRESSES.includes(e.address));
    expect(own).toEqual([{ address: treasury, label: "Казна" }]);
  });

  it("выбрасывает то, что адресом не является", () => {
    const got = parseExcluded({ excludedAddresses: ["нет адреса", "0x123", treasury] });
    const own = got.filter((e) => !BURN_ADDRESSES.includes(e.address));
    expect(own).toEqual([{ address: treasury, label: null }]);
  });

  it("обрезает список на двадцати записях", () => {
    const many = Array.from({ length: 40 }, (_, i) => "0x" + String(i + 10).repeat(20));
    const got = parseExcluded({ excludedAddresses: many });
    expect(got).toHaveLength(MAX_EXCLUDED);
  });
});

describe("computeSupply", () => {
  const a = "0x" + "1".repeat(40);
  const b = "0x" + "2".repeat(40);

  it("вычитает балансы исключений из общего выпуска", () => {
    const got = computeSupply({
      totalUnits: "1000000000000000000000", // 1000
      decimals: 18,
      balances: [
        { address: a, label: "Казна", units: "250000000000000000000", error: null }, // 250
        { address: b, label: null, units: "50000000000000000000", error: null }, // 50
      ],
    });
    expect(got.total).toBe("1000");
    expect(got.excludedTotal).toBe("300");
    expect(got.circulating).toBe("700");
    expect(got.partial).toBe(false);
    expect(got.excluded).toEqual([
      { address: a, label: "Казна", balance: "250", error: null },
      { address: b, label: null, balance: "50", error: null },
    ]);
  });

  it("исключения равны выпуску — оборот ноль", () => {
    const got = computeSupply({
      totalUnits: "100",
      decimals: 0,
      balances: [{ address: a, label: null, units: "100", error: null }],
    });
    expect(got.circulating).toBe("0");
  });

  it("исключения больше выпуска — ноль, а не отрицательный оборот", () => {
    const got = computeSupply({
      totalUnits: "100",
      decimals: 0,
      balances: [{ address: a, label: null, units: "500", error: null }],
    });
    expect(got.circulating).toBe("0");
    expect(got.excludedTotal).toBe("500");
  });

  it("адрес с ошибкой не входит в сумму и поднимает partial", () => {
    const got = computeSupply({
      totalUnits: "1000",
      decimals: 0,
      balances: [
        { address: a, label: null, units: "100", error: null },
        { address: b, label: null, units: null, error: "rpc_unreachable" },
      ],
    });
    expect(got.excludedTotal).toBe("100");
    expect(got.circulating).toBe("900");
    expect(got.partial).toBe(true);
    expect(got.excluded[1]).toEqual({
      address: b,
      label: null,
      balance: null,
      error: "rpc_unreachable",
    });
  });

  it("без исключений оборот равен общему выпуску", () => {
    const got = computeSupply({ totalUnits: "777", decimals: 0, balances: [] });
    expect(got.excludedTotal).toBe("0");
    expect(got.circulating).toBe("777");
  });
});

describe("claimedDeltaPct", () => {
  it("совпадение даёт ноль", () => {
    expect(claimedDeltaPct(700, "700")).toBe(0);
  });

  it("завышенное заявление даёт плюс", () => {
    expect(claimedDeltaPct(770, "700")).toBeCloseTo(10, 6);
  });

  it("заниженное заявление даёт минус", () => {
    expect(claimedDeltaPct(630, "700")).toBeCloseTo(-10, 6);
  });

  it("без заявления и при нулевом обороте — null", () => {
    expect(claimedDeltaPct(null, "700")).toBeNull();
    expect(claimedDeltaPct(700, "0")).toBeNull();
  });
});

describe("marketCap и fdv", () => {
  it("умножают цену на выпуск", () => {
    expect(marketCap(2, "700")).toBe(1400);
    expect(fdv(2, "1000")).toBe(2000);
  });

  it("без цены или без выпуска — null", () => {
    expect(marketCap(null, "700")).toBeNull();
    expect(marketCap(2, null)).toBeNull();
    expect(fdv(2, "мусор")).toBeNull();
  });
});

/* ─── чтение из сети ─────────────────────────────────────────────────────── */

const TOKEN = "0x" + "f".repeat(40);
const TREASURY = "0x" + "1".repeat(40);
const FUND = "0x" + "2".repeat(40);

function uintWord(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

/** Монеты → минимальные единицы при 18 знаках. */
function scale(coins: number): bigint {
  return BigInt(coins) * BigInt(10) ** BigInt(18);
}

/**
 * Узел, отвечающий по карте «данные вызова → ответ». Сети в тестах нет:
 * это ядро, по которому у монеты появляется капитализация.
 */
function fakeNode(plan: Record<string, string | { fail: "http" | "rpc" | "throw" }>): {
  fetchImpl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init!.body) as { params: [{ data: string }, string] };
    const data = body.params[0].data;
    calls.push(data);
    const answer = plan[data];
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof answer === "object") {
      if (answer.fail === "http") return { ok: false, status: 503, json: async () => ({}) };
      if (answer.fail === "throw") throw new Error("socket hang up");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: answer }) };
  };
  return { fetchImpl, calls };
}

const totalCall = SELECTORS.totalSupply;
const balanceCall = (addr: string) => SELECTORS.balanceOf + encodeAddressArg(addr);

describe("readSupplyFacts", () => {
  it("читает общий выпуск и балансы исключений", async () => {
    const { fetchImpl, calls } = fakeNode({
      [totalCall]: uintWord(BigInt(1000)),
      [balanceCall(TREASURY)]: uintWord(BigInt(250)),
      [balanceCall(FUND)]: uintWord(BigInt(50)),
    });
    const facts = await readSupplyFacts({
      chain: "ethereum",
      address: TOKEN,
      excluded: [
        { address: TREASURY, label: "Казна" },
        { address: FUND, label: null },
      ],
      fetchImpl,
    });
    expect(facts.error).toBeNull();
    expect(facts.totalUnits).toBe("1000");
    expect(facts.balances).toEqual([
      { address: TREASURY, label: "Казна", units: "250", error: null },
      { address: FUND, label: null, units: "50", error: null },
    ]);
    expect(calls).toHaveLength(3);
  });

  it("обрыв связи на одном адресе не ломает расчёт", async () => {
    const { fetchImpl } = fakeNode({
      [totalCall]: uintWord(BigInt(1000)),
      [balanceCall(TREASURY)]: { fail: "throw" },
      [balanceCall(FUND)]: uintWord(BigInt(50)),
    });
    const facts = await readSupplyFacts({
      chain: "ethereum",
      address: TOKEN,
      excluded: [
        { address: TREASURY, label: null },
        { address: FUND, label: null },
      ],
      fetchImpl,
    });
    expect(facts.totalUnits).toBe("1000");
    expect(facts.balances[0].error).toBe("rpc_unreachable");
    expect(facts.balances[1].units).toBe("50");

    const result = computeSupply({ totalUnits: facts.totalUnits!, decimals: 0, balances: facts.balances });
    expect(result.partial).toBe(true);
    expect(result.circulating).toBe("950");
  });

  it("revert на totalSupply — фатальная ошибка", async () => {
    const { fetchImpl } = fakeNode({ [totalCall]: { fail: "rpc" } });
    const facts = await readSupplyFacts({ chain: "ethereum", address: TOKEN, excluded: [], fetchImpl });
    expect(facts.error).toBe("supply_unreadable");
    expect(facts.totalUnits).toBeNull();
  });

  it("пустой ответ на totalSupply не декодируется", async () => {
    const { fetchImpl } = fakeNode({ [totalCall]: "0x" });
    const facts = await readSupplyFacts({ chain: "ethereum", address: TOKEN, excluded: [], fetchImpl });
    expect(facts.error).toBe("supply_unreadable");
  });

  it("неизвестная сеть и мусорный адрес до сети не доходят", async () => {
    const { fetchImpl, calls } = fakeNode({});
    expect(
      (await readSupplyFacts({ chain: "solana", address: TOKEN, excluded: [], fetchImpl })).error,
    ).toBe("chain_unsupported");
    expect(
      (await readSupplyFacts({ chain: "ethereum", address: "0x1", excluded: [], fetchImpl })).error,
    ).toBe("address_invalid");
    expect(calls).toHaveLength(0);
  });
});

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

type SupplyRecord = Record<string, unknown>;

function fakePrisma(cards: unknown[]): {
  prisma: PrismaLike;
  supplies: Map<string, SupplyRecord>;
  cardUpdates: SupplyRecord[];
} {
  const supplies = new Map<string, SupplyRecord>();
  const cardUpdates: SupplyRecord[] = [];
  const prisma: PrismaLike = {
    coinCard: {
      // Очередь собирается двумя запросами: сначала никогда не проверенные,
      // затем самые давние. Подделка отвечает по тому же признаку.
      findMany: async (args: unknown) => {
        const where = (args as { where: { supply?: { is?: null; isNot?: null } } }).where;
        const fresh = where.supply?.is === null;
        return cards.filter((c) =>
          fresh ? (c as { supply: unknown }).supply == null : (c as { supply: unknown }).supply != null,
        ) as never;
      },
      update: async (args: unknown) => {
        cardUpdates.push(args as SupplyRecord);
        return {};
      },
    },
    coinCardSupply: {
      upsert: async (args: unknown) => {
        const a = args as { where: { cardId: string }; update: SupplyRecord; create: SupplyRecord };
        const prev = supplies.get(a.where.cardId);
        supplies.set(a.where.cardId, prev ? { ...prev, ...a.update } : a.create);
        return {};
      },
    },
  };
  return { prisma, supplies, cardUpdates };
}

const canonicalContract = {
  chain: "ethereum",
  address: TOKEN,
  decimals: 18,
  onchainDecimals: 18,
};

describe("syncCardSupply", () => {
  it("пишет расчёт и провенанс VERIFIED_ONCHAIN", async () => {
    const { prisma, supplies, cardUpdates } = fakePrisma([
      {
        id: "card1",
        tokenomics: { circulating: 700, excluded: [{ address: TREASURY, label: "Казна" }] },
        provenance: {},
        contracts: [canonicalContract],
        supply: null,
      },
    ]);
    const { fetchImpl } = fakeNode({
      [totalCall]: uintWord(scale(1000)),
      [balanceCall(TREASURY)]: uintWord(scale(300)),
      [balanceCall(BURN_ADDRESSES[0])]: uintWord(BigInt(0)),
      [balanceCall(BURN_ADDRESSES[1])]: uintWord(BigInt(0)),
    });

    const stats = await syncCardSupply({ prisma, fetchImpl, now: new Date("2026-11-07T10:00:00Z") });
    expect(stats).toEqual({ cards: 1, ok: 1, partial: 0, failed: 0 });

    const row = supplies.get("card1")!;
    expect(row.totalSupply).toBe("1000");
    expect(row.circulating).toBe("700");
    expect(row.claimedDeltaPct).toBe(0);
    expect(row.checkError).toBeNull();

    const prov = (cardUpdates[0] as { data: { provenance: Record<string, { kind: string }> } }).data
      .provenance;
    expect(prov["supply.circulating"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("карточка без канонического контракта пропускается", async () => {
    const { prisma, supplies } = fakePrisma([
      { id: "card2", tokenomics: {}, provenance: {}, contracts: [], supply: null },
    ]);
    const { fetchImpl } = fakeNode({});
    const stats = await syncCardSupply({ prisma, fetchImpl });
    expect(stats.cards).toBe(0);
    expect(supplies.size).toBe(0);
  });

  it("неизвестные decimals — честная ошибка, а не нулевой выпуск", async () => {
    const { prisma, supplies } = fakePrisma([
      {
        id: "card3",
        tokenomics: {},
        provenance: {},
        contracts: [{ ...canonicalContract, decimals: null, onchainDecimals: null }],
        supply: null,
      },
    ]);
    const { fetchImpl } = fakeNode({});
    const stats = await syncCardSupply({ prisma, fetchImpl });
    expect(stats.failed).toBe(1);
    expect(supplies.get("card3")!.checkError).toBe("decimals_unknown");
  });

  it("недоступный узел пишет ошибку и не стирает прошлые числа", async () => {
    const card = {
      id: "card4",
      tokenomics: {},
      provenance: {},
      contracts: [canonicalContract],
      supply: { checkedAt: new Date("2026-11-06T10:00:00Z") },
    };
    const { prisma, supplies } = fakePrisma([card]);

    const good = fakeNode({
      [totalCall]: uintWord(scale(500)),
      [balanceCall(BURN_ADDRESSES[0])]: uintWord(BigInt(0)),
      [balanceCall(BURN_ADDRESSES[1])]: uintWord(BigInt(0)),
    });
    await syncCardSupply({ prisma, fetchImpl: good.fetchImpl });
    expect(supplies.get("card4")!.circulating).toBe("500");

    const bad = fakeNode({ [totalCall]: { fail: "http" } });
    const stats = await syncCardSupply({ prisma, fetchImpl: bad.fetchImpl });
    expect(stats.failed).toBe(1);
    const row = supplies.get("card4")!;
    expect(row.checkError).toBe("supply_unreadable");
    expect(row.circulating).toBe("500");
  });

  it("частичный расчёт считается отдельно от полного", async () => {
    const { prisma, supplies } = fakePrisma([
      {
        id: "card5",
        tokenomics: { excluded: [{ address: TREASURY, label: null }] },
        provenance: {},
        contracts: [canonicalContract],
        supply: null,
      },
    ]);
    const { fetchImpl } = fakeNode({
      [totalCall]: uintWord(scale(1000)),
      [balanceCall(TREASURY)]: { fail: "throw" },
      [balanceCall(BURN_ADDRESSES[0])]: uintWord(BigInt(0)),
      [balanceCall(BURN_ADDRESSES[1])]: uintWord(BigInt(0)),
    });
    const stats = await syncCardSupply({ prisma, fetchImpl });
    expect(stats).toEqual({ cards: 1, ok: 0, partial: 1, failed: 0 });
    expect(supplies.get("card5")!.partial).toBe(true);
  });
});
