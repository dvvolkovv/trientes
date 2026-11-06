import { describe, it, expect } from "vitest";
import { EVM_CHAINS, resolveEvmChain, rpcUrlFor } from "../src/lib/evm-chains";

describe("resolveEvmChain", () => {
  it("понимает, как проект на самом деле пишет сеть", () => {
    expect(resolveEvmChain("Ethereum")?.key).toBe("ethereum");
    expect(resolveEvmChain("eth")?.key).toBe("ethereum");
    expect(resolveEvmChain("ERC-20")?.key).toBe("ethereum");
    expect(resolveEvmChain("BNB Chain")?.key).toBe("bsc");
    expect(resolveEvmChain("binance smart chain")?.key).toBe("bsc");
    expect(resolveEvmChain("Arbitrum One")?.key).toBe("arbitrum");
    expect(resolveEvmChain("AVAX C-Chain")?.key).toBe("avalanche");
    expect(resolveEvmChain(" polygon ")?.key).toBe("polygon");
  });

  it("не-EVM сеть остаётся непрочитанной, а не угаданной", () => {
    expect(resolveEvmChain("Substrate")).toBeNull();
    expect(resolveEvmChain("Solana")).toBeNull();
    expect(resolveEvmChain("TON")).toBeNull();
    expect(resolveEvmChain("")).toBeNull();
    expect(resolveEvmChain(null)).toBeNull();
  });
});

describe("rpcUrlFor", () => {
  const eth = EVM_CHAINS.find((c) => c.key === "ethereum")!;

  it("без переопределения берёт публичный узел из реестра", () => {
    expect(rpcUrlFor(eth, {})).toBe(eth.defaultRpcUrl);
  });

  it("переопределение из окружения важнее реестра", () => {
    expect(rpcUrlFor(eth, { EVM_RPC_ETHEREUM: "https://my-node.example" })).toBe(
      "https://my-node.example",
    );
  });

  it("пустое переопределение игнорируется", () => {
    expect(rpcUrlFor(eth, { EVM_RPC_ETHEREUM: "   " })).toBe(eth.defaultRpcUrl);
  });

  it("у каждой сети свой адрес по https", () => {
    for (const c of EVM_CHAINS) expect(c.defaultRpcUrl).toMatch(/^https:\/\//);
    expect(new Set(EVM_CHAINS.map((c) => c.defaultRpcUrl)).size).toBe(EVM_CHAINS.length);
  });
});
