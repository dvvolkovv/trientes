import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  measureBlockSeconds,
  readAccountBalance,
  readBlockNumbers,
  readChainProperties,
  readGenesisHash,
  readRuntimeVersion,
  readTotalIssuance,
  queryTransferFee,
} from "../src/lib/substrate-rpc";

const URL_ = "https://node.example";
const ALICE = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";

/** Поддельный узел: отвечает по методу и записывает порядок вызовов. */
function node(answers: Record<string, unknown>): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
    calls.push(body.method);
    const a = answers[body.method];
    if (a === undefined) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ error: { message: "Method not found" } }),
      };
    }
    const result = typeof a === "function" ? (a as (p: unknown[]) => unknown)(body.params) : a;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  return { fetchImpl, calls };
}

const le = (v: bigint, bytes: number) =>
  `0x${Array.from({ length: bytes }, (_, i) =>
    Number((v >> BigInt(8 * i)) & BigInt(0xff))
      .toString(16)
      .padStart(2, "0"),
  ).join("")}`;

const accountInfo = (free: bigint, reserved: bigint) => {
  const b = new Uint8Array(80);
  for (let i = 0; i < 16; i++) {
    b[16 + i] = Number((free >> BigInt(8 * i)) & BigInt(0xff));
    b[32 + i] = Number((reserved >> BigInt(8 * i)) & BigInt(0xff));
  }
  return `0x${Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
};

describe("readChainProperties", () => {
  it("читает знаки, тикер и префикс", async () => {
    const { fetchImpl } = node({
      system_properties: { ss58Format: 10960, tokenDecimals: 12, tokenSymbol: "TAL" },
    });
    await expect(readChainProperties(URL_, { fetchImpl })).resolves.toEqual({
      decimals: 12,
      symbol: "TAL",
      ss58Format: 10960,
    });
  });

  it("префикс под другим написанием ключа: SS58Prefix и ss58format", async () => {
    // Живые ответы 9 ноября 2026: Moonbeam отдаёт SS58Prefix, Vara — ss58format.
    // Строгий поиск по `ss58Format` оставлял три сети без сверки префикса.
    const moonbeam = node({
      system_properties: { SS58Prefix: 1284, tokenDecimals: 18, tokenSymbol: "GLMR" },
    });
    await expect(readChainProperties(URL_, { fetchImpl: moonbeam.fetchImpl })).resolves.toEqual({
      decimals: 18,
      symbol: "GLMR",
      ss58Format: 1284,
    });
    const vara = node({
      system_properties: { ss58format: 137, tokenDecimals: 12, tokenSymbol: "VARA" },
    });
    await expect(readChainProperties(URL_, { fetchImpl: vara.fetchImpl })).resolves.toEqual({
      decimals: 12,
      symbol: "VARA",
      ss58Format: 137,
    });
  });

  it("префикса нет или он нечисловой — null, а не догадка", async () => {
    const absent = node({ system_properties: { tokenDecimals: 18, tokenSymbol: "RING" } });
    await expect(readChainProperties(URL_, { fetchImpl: absent.fetchImpl })).resolves.toEqual({
      decimals: 18,
      symbol: "RING",
      ss58Format: null,
    });
    const junk = node({
      system_properties: { ss58Format: "42", tokenDecimals: 12, tokenSymbol: "X" },
    });
    await expect(readChainProperties(URL_, { fetchImpl: junk.fetchImpl })).resolves.toEqual({
      decimals: 12,
      symbol: "X",
      ss58Format: null,
    });
  });

  it("массивы вместо скаляров (мультиассетные сети) — берётся первый", async () => {
    const { fetchImpl } = node({
      system_properties: { ss58Format: 2, tokenDecimals: [12, 10], tokenSymbol: ["KSM", "X"] },
    });
    await expect(readChainProperties(URL_, { fetchImpl })).resolves.toEqual({
      decimals: 12,
      symbol: "KSM",
      ss58Format: 2,
    });
  });

  it("мусор в ответе — decode_failed", async () => {
    const { fetchImpl } = node({ system_properties: "нет" });
    await expect(readChainProperties(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("readTotalIssuance", () => {
  it("декодирует u128 little-endian", async () => {
    const { fetchImpl } = node({ state_getStorage: "0x2b76f9092fcf23c34d00000000000000" });
    await expect(readTotalIssuance(URL_, { fetchImpl })).resolves.toBe(
      BigInt("1434460603938154051115"),
    );
  });

  it("пустое хранилище — decode_failed: у работающей цепи выпуск есть всегда", async () => {
    const { fetchImpl } = node({ state_getStorage: null });
    await expect(readTotalIssuance(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("readAccountBalance", () => {
  it("складывает free и reserved", async () => {
    const { fetchImpl } = node({ state_getStorage: accountInfo(BigInt(5), BigInt(9)) });
    await expect(readAccountBalance(URL_, ALICE, 0, { fetchImpl })).resolves.toBe(BigInt(14));
  });

  it("пустой счёт — ноль, а не ошибка", async () => {
    const { fetchImpl } = node({ state_getStorage: null });
    await expect(readAccountBalance(URL_, ALICE, 0, { fetchImpl })).resolves.toBe(BigInt(0));
  });

  it("чужой префикс сети — address_invalid, запроса не делаем", async () => {
    const { fetchImpl, calls } = node({ state_getStorage: null });
    await expect(readAccountBalance(URL_, ALICE, 10960, { fetchImpl })).rejects.toThrow(
      "address_invalid",
    );
    expect(calls).toEqual([]);
  });
});

describe("readGenesisHash", () => {
  it("берёт хэш нулевого блока", async () => {
    const { fetchImpl } = node({ chain_getBlockHash: `0x${"ab".repeat(32)}` });
    await expect(readGenesisHash(URL_, { fetchImpl })).resolves.toBe(`0x${"ab".repeat(32)}`);
  });

  it("не хэш — decode_failed", async () => {
    const { fetchImpl } = node({ chain_getBlockHash: "0xdead" });
    await expect(readGenesisHash(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("readBlockNumbers", () => {
  it("считает отставание финализации", async () => {
    const { fetchImpl } = node({
      chain_getHeader: (p: unknown[]) => ({ number: p.length === 0 ? "0xd4d311" : "0xd4d30f" }),
      chain_getFinalizedHead: "0xfin",
    });
    await expect(readBlockNumbers(URL_, { fetchImpl })).resolves.toEqual({
      best: 13947665,
      finalized: 13947663,
      lag: 2,
    });
  });

  it("заголовок без номера — decode_failed", async () => {
    const { fetchImpl } = node({ chain_getHeader: {}, chain_getFinalizedHead: "0xfin" });
    await expect(readBlockNumbers(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("measureBlockSeconds", () => {
  const timeNode = (oldMs: number, newMs: number) =>
    node({
      chain_getBlockHash: (p: unknown[]) => `0x${String(p[0])}`,
      state_getStorageAt: (p: unknown[]) =>
        String(p[1]) === "0x1000" ? le(BigInt(oldMs), 8) : le(BigInt(newMs), 8),
    });

  it("измеряет время блока по двум отметкам времени", async () => {
    const { fetchImpl } = timeNode(1_700_000_000_000, 1_700_000_600_000);
    await expect(measureBlockSeconds(URL_, 1100, 100, { fetchImpl })).resolves.toEqual({
      blockSeconds: 6,
      sample: 100,
    });
  });

  it("часы узла пошли назад — decode_failed, а не отрицательное время блока", async () => {
    const { fetchImpl } = timeNode(1_700_000_600_000, 1_700_000_000_000);
    await expect(measureBlockSeconds(URL_, 1100, 100, { fetchImpl })).rejects.toThrow(
      "decode_failed",
    );
  });

  it("выборка глубже самой цепи — decode_failed, запросов не делаем", async () => {
    const { fetchImpl, calls } = timeNode(1, 2);
    await expect(measureBlockSeconds(URL_, 50, 100, { fetchImpl })).rejects.toThrow(
      "decode_failed",
    );
    expect(calls).toEqual([]);
  });
});

describe("readRuntimeVersion", () => {
  it("читает имя и версии рантайма", async () => {
    const { fetchImpl } = node({
      state_getRuntimeVersion: { specName: "taler", specVersion: 12, transactionVersion: 2 },
    });
    await expect(readRuntimeVersion(URL_, { fetchImpl })).resolves.toEqual({
      specName: "taler",
      specVersion: 12,
      transactionVersion: 2,
    });
  });

  it("ответ без версии транзакций — decode_failed", async () => {
    const { fetchImpl } = node({ state_getRuntimeVersion: { specName: "taler" } });
    await expect(readRuntimeVersion(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("queryTransferFee", () => {
  /**
   * Узел, который отвечает комиссией только на экстринсик нужной длины, а на
   * любой другой — тем же сообщением, что живой узел: «Unable to query
   * dispatch info.» в поле error.
   */
  const feeNode = (acceptBodyLen: number) => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
      calls.push(body.method);
      // Первые два байта — компактная длина тела; дальше само тело.
      const bodyLen = String(body.params[0]).replace(/^0x/, "").length / 2 - 2;
      const payload =
        bodyLen === acceptBodyLen
          ? { result: { weight: { ref_time: 170798000 }, class: "normal", partialFee: "2633280" } }
          : { error: { message: "Unable to query dispatch info." } };
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, ...payload }) };
    };
    return { fetchImpl, calls };
  };

  it("считает комиссию в монетах по ответу узла", async () => {
    const { fetchImpl, calls } = feeNode(143);
    await expect(
      queryTransferFee({ url: URL_, pallet: 6, decimals: 12, fetchImpl }),
    ).resolves.toEqual({
      planck: BigInt(2633280),
      tokens: 0.00000263328,
      metadataHashMode: false,
    });
    expect(calls).toEqual(["payment_queryInfo"]);
  });

  it("сеть с CheckMetadataHash: первый вариант отклонён, второй принят", async () => {
    const { fetchImpl, calls } = feeNode(144);
    const fee = await queryTransferFee({ url: URL_, pallet: 5, decimals: 10, fetchImpl });
    expect(fee.metadataHashMode).toBe(true);
    expect(fee.planck).toBe(BigInt(2633280));
    expect(calls).toEqual(["payment_queryInfo", "payment_queryInfo"]);
  });

  it("оба варианта отклонены — decode_failed", async () => {
    const { fetchImpl } = feeNode(999);
    await expect(
      queryTransferFee({ url: URL_, pallet: 6, decimals: 12, fetchImpl }),
    ).rejects.toThrow("decode_failed");
  });

  it("нулевая комиссия — это ноль, а не отсутствие данных", async () => {
    const { fetchImpl } = node({ payment_queryInfo: { partialFee: "0" } });
    await expect(
      queryTransferFee({ url: URL_, pallet: 6, decimals: 12, fetchImpl }),
    ).resolves.toMatchObject({ planck: BigInt(0), tokens: 0 });
  });

  it("недоступный узел — rpc_unreachable, без подбора вариантов", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      queryTransferFee({ url: URL_, pallet: 6, decimals: 12, fetchImpl, retries: 0 }),
    ).rejects.toThrow("rpc_unreachable");
  });
});
