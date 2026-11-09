import { describe, expect, it } from "vitest";
import {
  BITCOIN_CHAINS,
  bitcoinApiUrlFor,
  resolveBitcoinChain,
  type BitcoinChain,
} from "../src/lib/bitcoin-chains";
import {
  measureBitcoinBlockSeconds,
  pickFeeEstimate,
  readBitcoinBlockAt,
  readBitcoinBlockHash,
  readBitcoinFeeRate,
  readBitcoinTip,
  transferFeeSats,
  type TextFetch,
} from "../src/lib/bitcoin-rest";
import { RpcError } from "../src/lib/json-rpc";

const BTC = resolveBitcoinChain("bitcoin")!;
const DOGE = resolveBitcoinChain("dogecoin")!;
const ESPLORA = "https://mempool.space/api";
const CYPHER = "https://api.blockcypher.com/v1/doge/main";

/** Хэш нужной формы: ридер отбрасывает всё, что не 64 hex. */
const hashAt = (height: number) => height.toString(16).padStart(64, "0");

type NodeOpts = {
  height?: number;
  timeMs?: number;
  stepMs?: number;
  /** Нет `/v1/fees/recommended` — как у DigiByte. */
  noRecommended?: boolean;
  /** Нет и `/fee-estimates` — как у Litecoin. */
  noEstimates?: boolean;
  feePerVb?: number;
  feePerKb?: number;
  status?: number;
  fail?: "unreachable" | "html";
  calls?: string[];
};

/** Поддельный узел Esplora. Ответы — по форме живых 9 ноября 2026. */
function esplora(opts: NodeOpts = {}): TextFetch {
  const height = opts.height ?? 975_185;
  const timeMs = opts.timeMs ?? Date.parse("2026-11-09T14:30:00Z");
  const step = opts.stepMs ?? 600_000;

  return async (url) => {
    opts.calls?.push(url);
    if (opts.fail === "unreachable") throw new Error("ECONNREFUSED");
    const text = (body: string, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    });
    if (opts.fail === "html") return text("<html>bot check</html>", 200);
    if (opts.status) return text(`http ${opts.status}`, opts.status);

    if (url.endsWith("/blocks/tip/height")) return text(String(height));
    if (url.includes("/block-height/")) {
      const h = Number(url.split("/block-height/")[1]);
      return text(hashAt(h));
    }
    if (url.includes("/block/")) {
      const hash = url.split("/block/")[1];
      const h = parseInt(hash, 16);
      return text(
        JSON.stringify({ id: hash, height: h, timestamp: Math.floor((timeMs - (height - h) * step) / 1000) }),
      );
    }
    if (url.endsWith("/v1/fees/recommended")) {
      if (opts.noRecommended) return text('endpoint does not exist "/v1/fees/recommended"', 404);
      return text(JSON.stringify({ fastestFee: 3, halfHourFee: opts.feePerVb ?? 2, hourFee: 1 }));
    }
    if (url.endsWith("/fee-estimates")) {
      if (opts.noEstimates) return text('endpoint does not exist "/fee-estimates"', 404);
      return text(JSON.stringify({ "1": 4.5, "6": opts.feePerVb ?? 2, "504": 1.1 }));
    }
    return text("not found", 404);
  };
}

/** Поддельный узел BlockCypher. */
function blockcypher(opts: NodeOpts = {}): TextFetch {
  const height = opts.height ?? 6_450_537;
  const timeMs = opts.timeMs ?? Date.parse("2026-11-09T14:38:24Z");
  const step = opts.stepMs ?? 60_000;

  return async (url) => {
    opts.calls?.push(url);
    if (opts.fail === "unreachable") throw new Error("ECONNREFUSED");
    const text = (body: string, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    });
    if (opts.status) return text(`http ${opts.status}`, opts.status);

    if (url.includes("/blocks/")) {
      const h = Number(url.split("/blocks/")[1]);
      return text(
        JSON.stringify({
          hash: hashAt(h),
          height: h,
          chain: "DOGE.main",
          time: new Date(timeMs - (height - h) * step).toISOString(),
        }),
      );
    }
    return text(
      JSON.stringify({
        name: "DOGE.main",
        height,
        hash: hashAt(height),
        time: new Date(timeMs).toISOString(),
        medium_fee_per_kb: opts.feePerKb ?? 62_345_835,
      }),
    );
  };
}

describe("реестр цепей Bitcoin", () => {
  it("ключи уникальны, адреса без слэша на конце, генезис — 64 hex", () => {
    const keys = BITCOIN_CHAINS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const chain of BITCOIN_CHAINS) {
      expect(chain.defaultApiUrl).not.toMatch(/\/$/);
      expect(chain.genesisHash).toMatch(/^[0-9a-f]{64}$/);
      expect(chain.decimals).toBe(8);
      expect(chain.txVsize).toBeGreaterThan(100);
    }
  });

  it("у Bitcoin есть контрольный блок: генезис общий с форками", () => {
    expect(BTC.checkpoint?.height).toBeGreaterThan(478_558);
    expect(BTC.checkpoint?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("неизвестный и пустой ключ не разрешаются", () => {
    expect(resolveBitcoinChain("bitcoin-cash")).toBeNull();
    expect(resolveBitcoinChain("")).toBeNull();
    expect(resolveBitcoinChain(null)).toBeNull();
  });

  it("адрес из окружения важнее реестра и теряет хвостовой слэш", () => {
    const url = bitcoinApiUrlFor(BTC, { BITCOIN_API_BITCOIN: "https://own.node/api/" });
    expect(url).toBe("https://own.node/api");
    expect(bitcoinApiUrlFor(BTC, {})).toBe(BTC.defaultApiUrl);
  });
});

describe("чтение блоков", () => {
  it("Esplora: голова читается через высоту, хэш и блок", async () => {
    const calls: string[] = [];
    const tip = await readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora({ calls }) });
    expect(tip.height).toBe(975_185);
    expect(tip.hash).toBe(hashAt(975_185));
    expect(tip.timeMs).toBe(Date.parse("2026-11-09T14:30:00Z"));
    expect(calls[0]).toBe(`${ESPLORA}/blocks/tip/height`);
  });

  it("BlockCypher: голова читается одним запросом в корень", async () => {
    const calls: string[] = [];
    const tip = await readBitcoinTip(DOGE, CYPHER, { fetchImpl: blockcypher({ calls }) });
    expect(tip.height).toBe(6_450_537);
    expect(calls).toEqual([CYPHER]);
  });

  it("блок не той высоты — разбор не принимается", async () => {
    const fetchImpl: TextFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: hashAt(7), height: 7, timestamp: 1 }),
    });
    // Запрошен блок 9, узел ответил про 7: подменённый ответ фактом не считаем.
    await expect(readBitcoinBlockAt(DOGE, CYPHER, 9, { fetchImpl })).rejects.toMatchObject({
      code: "decode_failed",
    });
  });

  it("хэш не той формы — decode_failed, а не молчаливое принятие", async () => {
    const fetchImpl: TextFetch = async () => ({ ok: true, status: 200, text: async () => "<html>" });
    await expect(readBitcoinBlockHash(BTC, ESPLORA, 0, { fetchImpl })).rejects.toMatchObject({
      code: "decode_failed",
    });
  });

  it("контрольный блок читается по высоте из реестра", async () => {
    const hash = await readBitcoinBlockHash(BTC, ESPLORA, BTC.checkpoint!.height, {
      fetchImpl: esplora(),
    });
    expect(hash).toBe(hashAt(BTC.checkpoint!.height));
  });

  it("время блока — замер по двум заголовкам", async () => {
    const tip = await readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora() });
    const measured = await measureBitcoinBlockSeconds(BTC, ESPLORA, tip, 100, {
      fetchImpl: esplora(),
    });
    expect(measured.blockSeconds).toBe(600);
    expect(measured.sample).toBe(100);
  });

  it("молодая цепь короче выборки: замер по тому, что есть", async () => {
    const node = esplora({ height: 20, stepMs: 30_000 });
    const tip = await readBitcoinTip(BTC, ESPLORA, { fetchImpl: node });
    const measured = await measureBitcoinBlockSeconds(BTC, ESPLORA, tip, 100, { fetchImpl: node });
    expect(measured.sample).toBe(19);
    expect(measured.blockSeconds).toBe(30);
  });
});

describe("классификация сбоя", () => {
  it("4xx — ответ узла: повтора нет", async () => {
    const calls: string[] = [];
    await expect(
      readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora({ status: 404, calls }) }),
    ).rejects.toMatchObject({ code: "rpc_error" });
    expect(calls).toHaveLength(1);
  });

  it("5xx — связь: один повтор", async () => {
    const calls: string[] = [];
    await expect(
      readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora({ status: 503, calls }) }),
    ).rejects.toMatchObject({ code: "rpc_unreachable" });
    expect(calls).toHaveLength(2);
  });

  it("429 считается связью, а не суждением о цепи", async () => {
    await expect(
      readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora({ status: 429 }) }),
    ).rejects.toMatchObject({ code: "rpc_unreachable" });
  });

  it("обрыв соединения — rpc_unreachable", async () => {
    await expect(
      readBitcoinTip(BTC, ESPLORA, { fetchImpl: esplora({ fail: "unreachable" }) }),
    ).rejects.toMatchObject({ code: "rpc_unreachable" });
  });

  it("страница проверки на бота вместо JSON — не факт о сети", async () => {
    const node = esplora({ fail: "html" });
    await expect(readBitcoinTip(DOGE, CYPHER, { fetchImpl: node })).rejects.toMatchObject({
      code: "rpc_unreachable",
    });
  });
});

describe("комиссия", () => {
  it("Esplora: берётся halfHourFee из рекомендаций", async () => {
    const rate = await readBitcoinFeeRate(BTC, ESPLORA, { fetchImpl: esplora({ feePerVb: 2.5 }) });
    expect(rate).toBe(2.5);
  });

  it("нет рекомендаций — берётся карта оценок (живой случай DigiByte)", async () => {
    const calls: string[] = [];
    const rate = await readBitcoinFeeRate(BTC, ESPLORA, {
      fetchImpl: esplora({ noRecommended: true, feePerVb: 370.7, calls }),
    });
    expect(rate).toBe(370.7);
    expect(calls.some((u) => u.endsWith("/fee-estimates"))).toBe(true);
  });

  it("нет ни того, ни другого — null, а не сбой чтения цепи", async () => {
    const rate = await readBitcoinFeeRate(BTC, ESPLORA, {
      fetchImpl: esplora({ noRecommended: true, noEstimates: true }),
    });
    expect(rate).toBeNull();
  });

  it("недоступный узел при чтении комиссии не превращается в null", async () => {
    await expect(
      readBitcoinFeeRate(BTC, ESPLORA, { fetchImpl: esplora({ status: 503 }) }),
    ).rejects.toBeInstanceOf(RpcError);
  });

  it("BlockCypher: цена за килобайт делится на 1000", async () => {
    const rate = await readBitcoinFeeRate(DOGE, CYPHER, {
      fetchImpl: blockcypher({ feePerKb: 62_000_000 }),
    });
    expect(rate).toBe(62_000);
  });

  it("карта оценок: берётся ближайший ключ не меньше цели", () => {
    expect(pickFeeEstimate({ "1": 9, "3": 5, "10": 2 }, 6)).toBe(2);
    expect(pickFeeEstimate({ "1": 9, "6": 5 }, 6)).toBe(5);
    // Ключа не меньше цели нет — берётся самый дальний: он не завышает.
    expect(pickFeeEstimate({ "1": 9, "2": 8 }, 6)).toBe(8);
    expect(pickFeeEstimate({}, 6)).toBeNull();
    expect(pickFeeEstimate({ "1": 0 }, 6)).toBeNull();
    expect(pickFeeEstimate(null, 6)).toBeNull();
  });

  it("комиссия эталонного перевода округляется вверх до сатоши", () => {
    expect(transferFeeSats(2, 141)).toBe(BigInt(282));
    expect(transferFeeSats(1.5, 141)).toBe(BigInt(212));
    expect(transferFeeSats(62_345.835, 226)).toBe(BigInt(14_090_159));
  });

  it("размер эталона берётся из реестра: segwit и legacy разные", () => {
    const btc: BitcoinChain = BTC;
    expect(btc.txVsize).toBe(141);
    expect(DOGE.txVsize).toBe(226);
  });
});
