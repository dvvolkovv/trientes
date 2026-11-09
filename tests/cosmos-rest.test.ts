import { describe, expect, it } from "vitest";
import { RpcError } from "../src/lib/json-rpc";
import {
  measureCosmosBlockSeconds,
  pickGasPrice,
  readCosmosBlock,
  readCosmosDenomMeta,
  readCosmosMinGasPrice,
  readCosmosSupply,
  type HttpFetch,
} from "../src/lib/cosmos-rest";

const BASE = "https://celestia-rest.publicnode.com";

/** Поддельный REST-узел Cosmos. Ответы — по форме живых 9 ноября 2026. */
function node(
  opts: {
    chainId?: string;
    height?: number;
    timeMs?: number;
    stepMs?: number;
    supply?: string;
    supplyDenom?: string;
    minGasPrice?: string;
    configUnimplemented?: boolean;
    meta?: unknown;
    metaError?: boolean;
    fail?: "unreachable" | "html";
    countCalls?: string[];
  } = {},
): HttpFetch {
  const height = opts.height ?? 15_724_506;
  const timeMs = opts.timeMs ?? Date.parse("2026-11-09T05:18:11.095Z");
  const step = opts.stepMs ?? 6_000;

  return async (url) => {
    opts.countCalls?.push(url);
    if (opts.fail === "unreachable") throw new Error("ECONNREFUSED");
    if (opts.fail === "html") {
      return {
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      };
    }
    const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

    if (url.includes("/blocks/")) {
      const raw = url.split("/blocks/")[1];
      const h = raw === "latest" ? height : Number(raw);
      return json({
        block: {
          header: {
            chain_id: opts.chainId ?? "celestia",
            height: String(h),
            time: new Date(timeMs - (height - h) * step).toISOString(),
          },
        },
      });
    }
    if (url.includes("/supply/by_denom")) {
      return json({
        amount: { denom: opts.supplyDenom ?? "utia", amount: opts.supply ?? "1181464869027930" },
      });
    }
    if (url.includes("/base/node/v1beta1/config") && opts.configUnimplemented) {
      // Живой ответ узла Neutron: запрос в этой сети не реализован.
      return json({ code: 12, message: "Not Implemented" }, false, 501);
    }
    if (url.includes("/denoms_metadata/")) {
      if (opts.metaError) return json({ code: 5, message: "client metadata for denom" }, false, 404);
      return json({
        metadata:
          opts.meta ?? {
            base: "utia",
            display: "TIA",
            symbol: "TIA",
            denom_units: [
              { denom: "utia", exponent: 0 },
              { denom: "TIA", exponent: 6 },
            ],
          },
      });
    }
    if (url.includes("/node/v1beta1/config")) {
      return json({ minimum_gas_price: opts.minGasPrice ?? "0.002000000000000000utia" });
    }
    return json({ code: 12, message: "not implemented" }, false, 501);
  };
}

describe("readCosmosBlock", () => {
  it("читает chain-id, высоту и время", async () => {
    const b = await readCosmosBlock(BASE, "latest", { fetchImpl: node() });
    expect(b.chainId).toBe("celestia");
    expect(b.height).toBe(15_724_506);
    expect(b.timeMs).toBe(Date.parse("2026-11-09T05:18:11.095Z"));
  });

  it("узел недоступен — rpc_unreachable", async () => {
    await expect(
      readCosmosBlock(BASE, "latest", { fetchImpl: node({ fail: "unreachable" }), retries: 0 }),
    ).rejects.toMatchObject({ code: "rpc_unreachable" });
  });

  it("узел отдал HTML вместо JSON — тоже сбой связи, а не факт о сети", async () => {
    await expect(
      readCosmosBlock(BASE, "latest", { fetchImpl: node({ fail: "html" }), retries: 0 }),
    ).rejects.toMatchObject({ code: "rpc_unreachable" });
  });

  it("на обрыве связи делается один повтор", async () => {
    const calls: string[] = [];
    let first = true;
    const flaky: HttpFetch = async (url, init) => {
      calls.push(url);
      if (first) {
        first = false;
        throw new Error("ECONNRESET");
      }
      return node()(url, init);
    };
    const b = await readCosmosBlock(BASE, "latest", { fetchImpl: flaky });
    expect(b.chainId).toBe("celestia");
    expect(calls).toHaveLength(2);
  });
});

describe("measureCosmosBlockSeconds", () => {
  it("делит разницу времени на разницу высот", async () => {
    const best = await readCosmosBlock(BASE, "latest", { fetchImpl: node({ stepMs: 11_500 }) });
    const got = await measureCosmosBlockSeconds(BASE, best, 200, {
      fetchImpl: node({ stepMs: 11_500 }),
    });
    expect(got).toEqual({ blockSeconds: 11.5, sample: 200 });
  });

  it("молодая цепь короче выборки — замер по тому, что есть", async () => {
    const best = await readCosmosBlock(BASE, "latest", { fetchImpl: node({ height: 50 }) });
    const got = await measureCosmosBlockSeconds(BASE, best, 200, {
      fetchImpl: node({ height: 50 }),
    });
    expect(got.sample).toBe(49);
  });
});

describe("readCosmosSupply", () => {
  it("читает выпуск в наименьших единицах", async () => {
    const got = await readCosmosSupply(BASE, "utia", { fetchImpl: node() });
    expect(got).toBe(BigInt("1181464869027930"));
  });

  it("узел ответил про другой деном — decode_failed, а не чужое число", async () => {
    await expect(
      readCosmosSupply(BASE, "utia", { fetchImpl: node({ supplyDenom: "uatom" }) }),
    ).rejects.toMatchObject({ code: "decode_failed" });
  });

  // Форк Sei отвечает на by_denom паникой: это ответ о сети, и он не должен
  // превращаться в тихий ноль.
  it("модуль отказал — rpc_error, а не ноль", async () => {
    const panic: HttpFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ code: 2, message: "invalid denom: by_denom: panic" }),
    });
    await expect(
      readCosmosSupply(BASE, "usei", { fetchImpl: panic, retries: 0 }),
    ).rejects.toMatchObject({ code: "rpc_error" });
  });
});

describe("readCosmosDenomMeta", () => {
  it("берёт отображаемый деном и его порядок", async () => {
    expect(await readCosmosDenomMeta(BASE, "utia", { fetchImpl: node() })).toEqual({
      symbol: "TIA",
      exponent: 6,
    });
  });

  it("display важнее symbol: у Initia в symbol лежит базовый деном", async () => {
    const meta = {
      base: "uinit",
      display: "init",
      symbol: "uinit",
      denom_units: [
        { denom: "uinit", exponent: 0 },
        { denom: "init", exponent: 6 },
      ],
    };
    expect(await readCosmosDenomMeta(BASE, "uinit", { fetchImpl: node({ meta }) })).toEqual({
      symbol: "INIT",
      exponent: 6,
    });
  });

  it("узел не знает реестра денома — пустые поля, а не ошибка", async () => {
    expect(await readCosmosDenomMeta(BASE, "inj", { fetchImpl: node({ metaError: true }) })).toEqual(
      { symbol: null, exponent: null },
    );
  });

  it("недоступный узел всё-таки ошибка", async () => {
    await expect(
      readCosmosDenomMeta(BASE, "utia", { fetchImpl: node({ fail: "unreachable" }), retries: 0 }),
    ).rejects.toBeInstanceOf(RpcError);
  });
});

describe("pickGasPrice", () => {
  it("берёт свой деном из списка и убирает нули в хвосте", () => {
    expect(pickGasPrice("0.002000000000000000utia", "utia")).toBe("0.002");
    expect(
      pickGasPrice(
        "12500000000.000000000000000000adydx,0.025000000000000000ibc/8E27BA2D",
        "adydx",
      ),
    ).toBe("12500000000");
    expect(pickGasPrice("0.025000000000000000uatone,0.225000000000000000uphoton", "uatone")).toBe(
      "0.025",
    );
    expect(pickGasPrice("1905.000000000000000000nhash", "nhash")).toBe("1905");
  });

  it("узел цену не объявил — null", () => {
    expect(pickGasPrice("", "utia")).toBeNull();
    expect(pickGasPrice(null, "utia")).toBeNull();
    expect(pickGasPrice("0.025uatone", "utia")).toBeNull();
  });

  it("мусор вместо числа не принимается", () => {
    expect(pickGasPrice("abcutia", "utia")).toBeNull();
  });
});

describe("readCosmosMinGasPrice", () => {
  it("читает цену газа в своём деноме", async () => {
    expect(await readCosmosMinGasPrice(BASE, "utia", { fetchImpl: node() })).toBe("0.002");
  });

  it("пустая цена у узла — null, а не ноль", async () => {
    expect(
      await readCosmosMinGasPrice(BASE, "usaga", { fetchImpl: node({ minGasPrice: "" }) }),
    ).toBeNull();
  });

  it("узел не реализует запрос (501 у Neutron) — null, а не сбой всего чтения", async () => {
    expect(
      await readCosmosMinGasPrice(BASE, "untrn", {
        fetchImpl: node({ configUnimplemented: true }),
      }),
    ).toBeNull();
  });
});
