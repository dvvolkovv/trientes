import { describe, expect, it } from "vitest";
import {
  EVM_CHAINS,
  resolveEvmChain,
  rpcUrlFor,
  TRANSFER_GAS,
} from "../src/lib/evm-chains";
import {
  finalityLagOf,
  hexToNumber,
  measureEvmBlockSeconds,
  readEvmBlock,
  readEvmChainId,
  readEvmGasPrice,
  readEvmHead,
  transferFeeWei,
} from "../src/lib/evm-chain-read";
import type { FetchLike } from "../src/lib/json-rpc";

const URL = "https://ethereum-rpc.publicnode.com";

type NodeOpts = {
  chainId?: number;
  head?: number;
  finalized?: number | null;
  stepMs?: number;
  genesis?: string | null;
  gasPrice?: bigint | null;
  gasUnsupported?: boolean;
  upperCaseHash?: boolean;
  fail?: "unreachable";
  calls?: string[];
};

/** Поддельный узел EVM. Ответы — по форме живых 9 ноября 2026. */
function node(opts: NodeOpts = {}): FetchLike {
  const head = opts.head ?? 23_900_100;
  const finalized = opts.finalized === undefined ? head - 93 : opts.finalized;
  const step = opts.stepMs ?? 12_000;
  const baseMs = Date.parse("2026-11-09T15:00:00Z");
  const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

  return (async (_url: string, init?: { body: string }) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    opts.calls?.push(`${method}:${String(params?.[0] ?? "")}`);
    if (opts.fail === "unreachable") throw new Error("ECONNREFUSED");

    const reply = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ result }) });
    const refuse = (message: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { message } }),
    });

    if (method === "eth_chainId") return reply(`0x${(opts.chainId ?? 1).toString(16)}`);
    if (method === "eth_gasPrice") {
      if (opts.gasUnsupported) return refuse("the method eth_gasPrice does not exist");
      return reply(`0x${(opts.gasPrice ?? BigInt(367_300_000)).toString(16)}`);
    }
    if (method === "eth_getBlockByNumber") {
      const tag = params[0] as string;
      let n: number;
      if (tag === "latest") n = head;
      else if (tag === "finalized") {
        if (finalized === null) return reply(null);
        n = finalized;
      } else {
        n = Number(BigInt(tag));
        if (n === 0 && opts.genesis === null) return reply(null);
      }
      const raw = n === 0 && opts.genesis ? opts.genesis : hashOf(n);
      return reply({
        number: `0x${n.toString(16)}`,
        hash: opts.upperCaseHash ? raw.toUpperCase() : raw,
        timestamp: `0x${Math.floor((baseMs - (head - n) * step) / 1000).toString(16)}`,
      });
    }
    return refuse("unknown method");
  }) as unknown as FetchLike;
}

describe("реестр EVM-сетей", () => {
  it("ключи и chainId уникальны, у всех 18 знаков и 21 000 газа", () => {
    const keys = EVM_CHAINS.map((c) => c.key);
    const ids = EVM_CHAINS.map((c) => c.chainId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chain of EVM_CHAINS) {
      expect(chain.decimals).toBe(18);
      expect(chain.transferGas).toBe(TRANSFER_GAS);
      expect(chain.symbol).toMatch(/^[A-Z]+$/);
      if (chain.genesisHash) expect(chain.genesisHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("алиасы ведут к своей сети, неизвестное — к null", () => {
    expect(resolveEvmChain("BNB")?.key).toBe("bsc");
    expect(resolveEvmChain("hyperevm")?.key).toBe("hyperliquid");
    expect(resolveEvmChain("klaytn")?.key).toBe("kaia");
    expect(resolveEvmChain("matic")?.key).toBe("polygon");
    expect(resolveEvmChain("solana")).toBeNull();
    expect(resolveEvmChain("")).toBeNull();
  });

  it("у сетей без блока 0 генезис не пришпилен: Cronos и Hyperliquid", () => {
    expect(resolveEvmChain("cronos")?.genesisHash).toBeUndefined();
    expect(resolveEvmChain("hyperliquid")?.genesisHash).toBeUndefined();
  });

  it("адрес из окружения важнее реестра", () => {
    const eth = resolveEvmChain("ethereum")!;
    expect(rpcUrlFor(eth, { EVM_RPC_ETHEREUM: "https://own.node" })).toBe("https://own.node");
    expect(rpcUrlFor(eth, {})).toBe(eth.defaultRpcUrl);
  });
});

describe("чтение сети EVM", () => {
  it("читает chainId, головы и время блока", async () => {
    const chainId = await readEvmChainId(URL, { fetchImpl: node() });
    expect(chainId).toBe(1);

    const head = await readEvmHead(URL, { fetchImpl: node() });
    expect(head.number).toBe(23_900_100);

    const measured = await measureEvmBlockSeconds(URL, head, 100, { fetchImpl: node() });
    expect(measured.blockSeconds).toBe(12);
    expect(measured.sample).toBe(100);
  });

  it("тег finalized читается номером блока", async () => {
    const fin = await readEvmBlock(URL, "finalized", { fetchImpl: node() });
    expect(fin?.number).toBe(23_900_100 - 93);
  });

  it("цепь без тега finalized отдаёт null, а не сбой", async () => {
    const fin = await readEvmBlock(URL, "finalized", { fetchImpl: node({ finalized: null }) });
    expect(fin).toBeNull();
  });

  it("обрезанная база без блока 0 отдаёт null (живой случай Cronos)", async () => {
    const genesis = await readEvmBlock(URL, 0, { fetchImpl: node({ genesis: null }) });
    expect(genesis).toBeNull();
  });

  it("хэш приводится к нижнему регистру (живой случай Sei)", async () => {
    const head = await readEvmBlock(URL, 0, {
      fetchImpl: node({ genesis: `0x${"ab".repeat(32)}`, upperCaseHash: true }),
    });
    expect(head?.hash).toBe(`0x${"ab".repeat(32)}`);
  });

  it("недоступный узел остаётся сбоем связи", async () => {
    await expect(readEvmChainId(URL, { fetchImpl: node({ fail: "unreachable" }) })).rejects.toMatchObject(
      { code: "rpc_unreachable" },
    );
  });

  it("отрицательное отставание — артефакт чтения, приводится к нулю", () => {
    expect(finalityLagOf(100, 101)).toBe(0);
    expect(finalityLagOf(100, 100)).toBe(0);
    expect(finalityLagOf(100, 93)).toBe(7);
  });

  it("мусор вместо hex не притворяется нулём", () => {
    expect(() => hexToNumber("")).toThrow();
    expect(() => hexToNumber("abc")).toThrow();
    expect(() => hexToNumber(null)).toThrow();
    expect(hexToNumber("0x1a")).toBe(26);
  });
});

describe("комиссия EVM", () => {
  it("цена газа читается, комиссия — цена × 21 000", async () => {
    const price = await readEvmGasPrice(URL, { fetchImpl: node({ gasPrice: BigInt(1_000_000_000) }) });
    expect(price).toBe(BigInt(1_000_000_000));
    expect(transferFeeWei(price!, TRANSFER_GAS)).toBe(BigInt("21000000000000"));
    // 21 000 × 1 gwei = 0,000021 монеты.
    expect(Number(transferFeeWei(price!, TRANSFER_GAS)) / 1e18).toBeCloseTo(0.000021, 12);
  });

  it("узел без eth_gasPrice — null, а не сбой чтения цепи", async () => {
    const price = await readEvmGasPrice(URL, { fetchImpl: node({ gasUnsupported: true }) });
    expect(price).toBeNull();
  });

  it("нулевая цена газа считается неизвестной", async () => {
    const price = await readEvmGasPrice(URL, { fetchImpl: node({ gasPrice: BigInt(0) }) });
    expect(price).toBeNull();
  });
});
