import { describe, expect, it } from "vitest";
import {
  COSMOS_CHAIN_KEYS,
  COSMOS_CHAINS,
  cosmosRestUrlFor,
  resolveCosmosChain,
} from "../src/lib/cosmos-chains";
import { SUBSTRATE_CHAINS } from "../src/lib/substrate-chains";

describe("resolveCosmosChain", () => {
  it("находит сеть по ключу, не считая сетью родовое слово", () => {
    expect(resolveCosmosChain("celestia")?.chainId).toBe("celestia");
    expect(resolveCosmosChain(" Celestia ")?.key).toBe("celestia");
    // Родовое слово семьи — не сеть: у Cosmos Hub ключ `cosmoshub`.
    expect(resolveCosmosChain("cosmos")).toBeNull();
    expect(resolveCosmosChain("cosmoshub")?.chainId).toBe("cosmoshub-4");
    expect(resolveCosmosChain("")).toBeNull();
    expect(resolveCosmosChain(null)).toBeNull();
    expect(resolveCosmosChain("polkadot")).toBeNull();
  });
});

describe("реестр как целое", () => {
  it("двадцать сетей, и все поля заполнены", () => {
    expect(COSMOS_CHAINS).toHaveLength(20);
    for (const c of COSMOS_CHAINS) {
      expect(c.defaultRestUrl).toMatch(/^https:\/\//);
      expect(c.defaultRestUrl).not.toMatch(/\/$/);
      expect(c.chainId.length).toBeGreaterThan(0);
      expect(c.denom.length).toBeGreaterThan(0);
      expect(c.exponent).toBeGreaterThan(0);
      expect(c.symbol).toBe(c.symbol.toUpperCase());
      expect(c.bech32Prefix).toMatch(/^[a-z]+$/);
    }
  });

  it("ключи уникальны и не пересекаются с Substrate", () => {
    expect(new Set(COSMOS_CHAIN_KEYS).size).toBe(COSMOS_CHAIN_KEYS.length);
    // Иначе `nativeChain` карточки перестал бы однозначно указывать на семью.
    const substrate = new Set(SUBSTRATE_CHAINS.map((c) => c.key));
    for (const key of COSMOS_CHAIN_KEYS) expect(substrate.has(key)).toBe(false);
  });
});

describe("cosmosRestUrlFor", () => {
  const tia = resolveCosmosChain("celestia")!;

  it("по умолчанию берёт адрес из реестра", () => {
    expect(cosmosRestUrlFor(tia, {})).toBe("https://celestia-rest.publicnode.com");
  });

  it("переопределение из окружения важнее реестра, слэш на конце снимается", () => {
    expect(cosmosRestUrlFor(tia, { COSMOS_REST_CELESTIA: "https://alt.example/" })).toBe(
      "https://alt.example",
    );
    expect(cosmosRestUrlFor(tia, { COSMOS_REST_CELESTIA: "   " })).toBe(
      "https://celestia-rest.publicnode.com",
    );
  });
});
