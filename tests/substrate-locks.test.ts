import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  accountFrozen,
  decodeBalanceLocks,
  LOCKS_STORAGE,
  locksPrefix,
  readLockedSupply,
} from "../src/lib/substrate-locks";
import { RpcError } from "../src/lib/json-rpc";
import { readSubstrateSupplyFacts } from "../src/lib/coin-card-supply";

/**
 * Живая запись из сети Taler, блок 14 015 692: у счёта две блокировки на одну
 * и ту же сумму — 136 111 109,75 TAL (12 знаков) в стейкинге и столько же в
 * вестинге. Это одни и те же монеты, и в этом весь смысл максимума.
 */
const LIVE =
  "0x087374616b696e6720001cf5882bcdeb6007000000000000000276657374696e6720001cf5882bcdeb60070000000000000001";
const LIVE_FROZEN = BigInt("136111109750000000000");
const HEAD = `0x${"cd".repeat(32)}`;
const BLOCK = 14_015_692;

describe("decodeBalanceLocks", () => {
  it("читает живую запись сети: два имени и две суммы", () => {
    expect(decodeBalanceLocks(LIVE)).toEqual([
      { id: "staking", units: LIVE_FROZEN },
      { id: "vesting", units: LIVE_FROZEN },
    ]);
  });

  it("пустой вектор — счёт без блокировок, а не ошибка", () => {
    expect(decodeBalanceLocks("0x00")).toEqual([]);
  });

  it("не принимает обрезанную запись", () => {
    expect(() => decodeBalanceLocks(LIVE.slice(0, 40))).toThrow(RpcError);
  });

  it("не принимает лишний хвост", () => {
    expect(() => decodeBalanceLocks(`${LIVE}00`)).toThrow(RpcError);
  });

  it("не принимает ответ без значения", () => {
    expect(() => decodeBalanceLocks(null)).toThrow(RpcError);
  });
});

describe("accountFrozen", () => {
  it("блокировки перекрываются: неподвижен максимум, а не сумма", () => {
    // Живой случай Taler: те же монеты заморожены вестингом и отданы в стейкинг.
    expect(accountFrozen(decodeBalanceLocks(LIVE))).toBe(LIVE_FROZEN);
  });

  it("разные суммы — считается большая", () => {
    expect(
      accountFrozen([
        { id: "vesting", units: BigInt(1000) },
        { id: "staking", units: BigInt(1200) },
      ]),
    ).toBe(BigInt(1200));
  });

  it("блокировок нет — ноль", () => {
    expect(accountFrozen([])).toBe(BigInt(0));
  });
});

describe("ключ хранилища", () => {
  it("имя хранилища названо тем же, чем подписана строка расчёта", () => {
    expect(LOCKS_STORAGE).toBe("Balances.Locks");
    expect(locksPrefix()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

/** Узел с картой блокировок: `accounts` счетов, у каждого живая запись. */
function locksNode(args: {
  accounts: number;
  seen?: Array<{ method: string; params: unknown[] }>;
  dropValue?: boolean;
}): FetchLike {
  const keys = Array.from(
    { length: args.accounts },
    (_, i) => `${locksPrefix()}${String(i).padStart(64, "0")}`,
  );
  return async (_url, init) => {
    const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
    args.seen?.push(body);
    let result: unknown = null;
    if (body.method === "chain_getBlockHash") result = HEAD;
    else if (body.method === "chain_getHeader") result = { number: `0x${BLOCK.toString(16)}` };
    else if (body.method === "state_getKeysPaged") result = keys;
    else if (body.method === "state_queryStorageAt") {
      const asked = body.params[0] as string[];
      result = [{ changes: asked.map((k, i) => [k, args.dropValue && i === 0 ? null : LIVE]) }];
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("readLockedSupply", () => {
  it("считает неподвижное по всей карте блокировок", async () => {
    const got = await readLockedSupply("https://node", { fetchImpl: locksNode({ accounts: 8 }) });
    expect(got.accounts).toBe(8);
    expect(got.block).toBe(BLOCK);
    // Восемь счетов по максимуму — живой итог сети, а не вдвое больше.
    expect(got.units).toBe(LIVE_FROZEN * BigInt(8));
    expect(got.reasons).toEqual(["staking", "vesting"]);
  });

  // Между страницами обхода может пройти перевод, и тогда сумма относилась бы
  // к двум состояниям сети: и ключи, и значения спрашиваются на одном блоке.
  it("ключи и значения спрашиваются на одном блоке", async () => {
    const seen: Array<{ method: string; params: unknown[] }> = [];
    await readLockedSupply("https://node", { fetchImpl: locksNode({ accounts: 3, seen }) });
    const keys = seen.find((c) => c.method === "state_getKeysPaged");
    const values = seen.find((c) => c.method === "state_queryStorageAt");
    expect(keys?.params[3]).toBe(HEAD);
    expect(values?.params[1]).toBe(HEAD);
  });

  // Ключ без значения нулём не считается: это занизило бы заморозку, то есть
  // завысило бы оборот и капитализацию.
  it("ключ без значения — отказ, а не ноль", async () => {
    await expect(
      readLockedSupply("https://node", { fetchImpl: locksNode({ accounts: 3, dropValue: true }) }),
    ).rejects.toThrow();
  });
});

/** Узел сети Taler целиком: свойства, выпуск, генезис и карта блокировок. */
function talerNode(totalCoins: bigint, accounts: number): FetchLike {
  const issuance = totalCoins * BigInt(10) ** BigInt(12);
  const locks = locksNode({ accounts });
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
    return locks(url, init);
  };
}

describe("выпуск Taler за вычетом неподвижного", () => {
  it("заморозка становится строкой исключения и называет свои виды", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "taler",
      excluded: [],
      fetchImpl: talerNode(BigInt(1_435_891_583), 8),
    });
    expect(facts.error).toBeNull();
    const row = facts.balances.at(-1);
    expect(row?.address).toBe("Balances.Locks");
    expect(row?.label).toBe("staking+vesting · 8");
    expect(row?.units).toBe((LIVE_FROZEN * BigInt(8)).toString());
  });

  // Выпуск без вычета — завышенный оборот: числа такой карточки лучше не
  // трогать вовсе, чем обновить неверными.
  it("заморозка не прочитана — не пишем ничего", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "taler",
      excluded: [],
      fetchImpl: async (_url, init) => {
        const { method } = JSON.parse(init!.body) as { method: string };
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
        // Карта блокировок не отдаётся.
        return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: null }) };
      },
    });
    expect(facts.error).toBe("locks_unreadable");
    expect(facts.totalUnits).toBeNull();
    // Знаки и генезис сеть уже подтвердила — их сорванное чтение не стирает.
    expect(facts.decimals).toBe(12);
    expect(facts.genesisHash).toBe(HEAD);
  });

  // У чужой сети карта блокировок может быть на тысячи счетов, и публичный
  // узел оборвёт обход на середине — такую сеть не обходим вовсе.
  it("сеть без флага карту не обходит", async () => {
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
