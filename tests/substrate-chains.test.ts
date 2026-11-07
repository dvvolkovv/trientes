import { describe, expect, it } from "vitest";
import {
  NATIVE_CHAIN_KEYS,
  resolveSubstrateChain,
  SUBSTRATE_CHAINS,
  substrateRpcUrlFor,
} from "../src/lib/substrate-chains";

describe("resolveSubstrateChain", () => {
  it("находит сеть по ключу и по написанию с заглавной", () => {
    expect(resolveSubstrateChain("taler")?.key).toBe("taler");
    expect(resolveSubstrateChain("Taler")?.key).toBe("taler");
    expect(resolveSubstrateChain(" polkadot ")?.key).toBe("polkadot");
  });

  it("родовое слово «substrate» сетью не считается", () => {
    expect(resolveSubstrateChain("substrate")).toBeNull();
    expect(resolveSubstrateChain("")).toBeNull();
    expect(resolveSubstrateChain(null)).toBeNull();
    expect(resolveSubstrateChain("ethereum")).toBeNull();
  });

  it("ключи для формы совпадают с реестром", () => {
    expect(NATIVE_CHAIN_KEYS).toEqual(SUBSTRATE_CHAINS.map((c) => c.key));
  });
});

describe("substrateRpcUrlFor", () => {
  const taler = resolveSubstrateChain("taler")!;

  it("по умолчанию берёт адрес из реестра", () => {
    expect(substrateRpcUrlFor(taler, {})).toBe("https://node.taler.uno");
  });

  it("переопределение из окружения важнее реестра", () => {
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "https://alt.example" })).toBe(
      "https://alt.example",
    );
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "   " })).toBe(
      "https://node.taler.uno",
    );
  });
});
