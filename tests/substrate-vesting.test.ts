import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  decodeVestingSchedules,
  lockedAt,
  readVestingLocked,
  totalLockedAt,
  vestingPrefix,
} from "../src/lib/substrate-vesting";
import { readSubstrateSupplyFacts } from "../src/lib/coin-card-supply";

/**
 * Живая запись из сети Taler, блок 14 012 392: одно расписание на
 * 136 111 109,75 TAL (12 знаков) со сроком на блоке 52 560 000.
 */
const LIVE = "0x04001cf5882bcdeb600700000000000000001cf5882bcdeb60070000000000000080002203";
const LIVE_LOCKED = BigInt("136111109750000000000");
const CLIFF = 52_560_000;
const HEAD = `0x${"cd".repeat(32)}`;

describe("decodeVestingSchedules", () => {
  it("читает живую запись сети", () => {
    expect(decodeVestingSchedules(LIVE)).toEqual([
      { locked: LIVE_LOCKED, perBlock: LIVE_LOCKED, startingBlock: CLIFF },
    ]);
  });

  it("не принимает обрезанную запись", () => {
    expect(() => decodeVestingSchedules(LIVE.slice(0, 40))).toThrow();
  });

  it("не принимает лишний хвост", () => {
    expect(() => decodeVestingSchedules(`${LIVE}00`)).toThrow();
  });

  it("не принимает ответ без значения", () => {
    expect(() => decodeVestingSchedules(null)).toThrow();
  });
});

describe("lockedAt", () => {
  const schedule = { locked: LIVE_LOCKED, perBlock: LIVE_LOCKED, startingBlock: CLIFF };

  it("до срока заморожено всё", () => {
    expect(lockedAt(schedule, 14_012_392)).toBe(LIVE_LOCKED);
    expect(lockedAt(schedule, CLIFF)).toBe(LIVE_LOCKED);
  });

  it("после срока не заморожено ничего, и в минус не уходит", () => {
    expect(lockedAt(schedule, CLIFF + 1)).toBe(BigInt(0));
    expect(lockedAt(schedule, CLIFF + 1_000_000)).toBe(BigInt(0));
  });

  it("расписание с выдачей по блокам распускается постепенно", () => {
    const linear = { locked: BigInt(1000), perBlock: BigInt(10), startingBlock: 100 };
    expect(lockedAt(linear, 150)).toBe(BigInt(500));
    expect(lockedAt(linear, 200)).toBe(BigInt(0));
  });

  it("сумма берётся по всем расписаниям счёта", () => {
    expect(
      totalLockedAt(
        [
          { locked: BigInt(1000), perBlock: BigInt(10), startingBlock: 100 },
          { locked: BigInt(400), perBlock: BigInt(400), startingBlock: 9_000 },
        ],
        150,
      ),
    ).toBe(BigInt(900));
  });
});

/** Узел с картой расписаний: `accounts` счетов, у каждого живая запись. */
function vestingNode(args: {
  accounts: number;
  block: number;
  seen?: Array<{ method: string; params: unknown[] }>;
  dropValue?: boolean;
}): FetchLike {
  const keys = Array.from({ length: args.accounts }, (_, i) => `${vestingPrefix()}${String(i).padStart(64, "0")}`);
  return async (_url, init) => {
    const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
    args.seen?.push(body);
    let result: unknown = null;
    if (body.method === "chain_getBlockHash") result = HEAD;
    else if (body.method === "chain_getHeader") result = { number: `0x${args.block.toString(16)}` };
    else if (body.method === "state_getKeysPaged") result = keys;
    else if (body.method === "state_queryStorageAt") {
      const asked = body.params[0] as string[];
      result = [
        {
          changes: asked.map((k, i) => [k, args.dropValue && i === 0 ? null : LIVE]),
        },
      ];
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("readVestingLocked", () => {
  it("считает заморозку по всей карте расписаний", async () => {
    const got = await readVestingLocked("https://node", {
      fetchImpl: vestingNode({ accounts: 8, block: 14_012_392 }),
    });
    expect(got.accounts).toBe(8);
    expect(got.block).toBe(14_012_392);
    // Живой итог сети: 1 088 888 878 TAL.
    expect(got.units).toBe(LIVE_LOCKED * BigInt(8));
  });

  // Между страницами обхода может пройти выдача, и тогда сумма относилась бы к
  // двум состояниям сети: и ключи, и значения спрашиваются на одном блоке.
  it("ключи и значения спрашиваются на одном блоке", async () => {
    const seen: Array<{ method: string; params: unknown[] }> = [];
    await readVestingLocked("https://node", {
      fetchImpl: vestingNode({ accounts: 3, block: 100, seen }),
    });
    const keys = seen.find((c) => c.method === "state_getKeysPaged");
    const values = seen.find((c) => c.method === "state_queryStorageAt");
    expect(keys?.params[3]).toBe(HEAD);
    expect(values?.params[1]).toBe(HEAD);
  });

  it("после срока заморозки не остаётся", async () => {
    const got = await readVestingLocked("https://node", {
      fetchImpl: vestingNode({ accounts: 8, block: CLIFF + 1 }),
    });
    expect(got.units).toBe(BigInt(0));
  });

  // Ключ без значения нулём не считается: это занизило бы заморозку, то есть
  // завысило бы оборот и капитализацию.
  it("ключ без значения — отказ, а не ноль", async () => {
    await expect(
      readVestingLocked("https://node", {
        fetchImpl: vestingNode({ accounts: 3, block: 100, dropValue: true }),
      }),
    ).rejects.toThrow();
  });
});

/** Узел сети Taler целиком: свойства, выпуск, генезис и карта расписаний. */
function talerNode(totalCoins: bigint, accounts: number): FetchLike {
  const issuance = totalCoins * BigInt(10) ** BigInt(12);
  const vesting = vestingNode({ accounts, block: 14_012_392 });
  return async (url, init) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    if (method === "system_properties") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { ss58Format: 10960, tokenDecimals: 12, tokenSymbol: "TAL" },
        }),
      };
    }
    if (method === "chain_getBlockHash" && params.length > 0) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: HEAD }) };
    }
    if (method === "state_getStorage") {
      const le = `0x${Array.from({ length: 16 }, (_, i) =>
        Number((issuance >> BigInt(8 * i)) & BigInt(0xff))
          .toString(16)
          .padStart(2, "0"),
      ).join("")}`;
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: le }) };
    }
    return vesting(url, init);
  };
}

describe("выпуск Taler за вычетом заморозки", () => {
  it("заморозка становится строкой исключения", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "taler",
      excluded: [],
      fetchImpl: talerNode(BigInt(1_435_891_583), 8),
    });
    expect(facts.error).toBeNull();
    const row = facts.balances.at(-1);
    expect(row?.address).toBe("Vesting.Vesting");
    expect(row?.label).toBe("vesting · 8");
    expect(row?.units).toBe((LIVE_LOCKED * BigInt(8)).toString());
  });

  // Выпуск без вычета — завышенный оборот: числа такой карточки лучше не
  // трогать вовсе, чем обновить неверными.
  it("заморозка не прочитана — не пишем ничего", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "taler",
      excluded: [],
      fetchImpl: async (_url, init) => {
        const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
        if (method === "system_properties") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: 1,
              result: { ss58Format: 10960, tokenDecimals: 12, tokenSymbol: "TAL" },
            }),
          };
        }
        if (method === "chain_getBlockHash") {
          return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: HEAD }) };
        }
        if (method === "state_getStorage") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ jsonrpc: "2.0", id: 1, result: `0x${"01".repeat(16)}` }),
          };
        }
        // Карта расписаний не отдаётся.
        return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: null }) };
      },
    });
    expect(facts.error).toBe("vesting_unreadable");
    expect(facts.totalUnits).toBeNull();
    // Знаки и генезис сеть уже подтвердила — их сорванное чтение не стирает.
    expect(facts.decimals).toBe(12);
    expect(facts.genesisHash).toBe(HEAD);
  });

  // У сети без заморозки обхода не бывает вовсе: карта чужой цепи может быть
  // на тысячи счетов, и публичный узел оборвёт обход на середине.
  it("сеть без вестинга карту не обходит", async () => {
    const seen: Array<{ method: string; params: unknown[] }> = [];
    await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [],
      fetchImpl: async (url, init) => {
        seen.push(JSON.parse(init!.body) as { method: string; params: unknown[] });
        return talerNode(BigInt(1), 1)(url, init);
      },
    });
    expect(seen.some((c) => c.method === "state_getKeysPaged")).toBe(false);
  });
});
