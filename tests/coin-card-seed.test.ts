import { describe, expect, it } from "vitest";
import { chainFamily, plannedCard, SEED_CARDS } from "../src/lib/coin-card-seed";
import { resolveBitcoinChain } from "../src/lib/bitcoin-chains";
import { resolveCosmosChain } from "../src/lib/cosmos-chains";
import { resolveEvmChain } from "../src/lib/evm-chains";
import { resolveSubstrateChain } from "../src/lib/substrate-chains";

describe("таблица посева", () => {
  it("каждая строка указывает на существующую сеть", () => {
    for (const row of SEED_CARDS) {
      expect(chainFamily(row.chain), row.chain).not.toBeNull();
    }
  });

  it("ни монета, ни сеть не повторяются", () => {
    const coins = SEED_CARDS.map((r) => r.coinId);
    const chains = SEED_CARDS.map((r) => r.chain);
    expect(new Set(coins).size).toBe(coins.length);
    expect(new Set(chains).size).toBe(chains.length);
  });

  it("пятьдесят пять монет: 16 Substrate, 20 Cosmos, 5 Bitcoin, 14 EVM", () => {
    expect(SEED_CARDS).toHaveLength(55);
    const byFamily = SEED_CARDS.map((r) => chainFamily(r.chain));
    expect(byFamily.filter((f) => f === "SUBSTRATE")).toHaveLength(16);
    expect(byFamily.filter((f) => f === "COSMOS")).toHaveLength(20);
    expect(byFamily.filter((f) => f === "BITCOIN")).toHaveLength(5);
    expect(byFamily.filter((f) => f === "EVM")).toHaveLength(14);
  });

  it("сети L2 на чужой монете в посев не попадают", () => {
    // Нативная монета Arbitrum, Optimism и Base — тот же ETH, и карточка ETH
    // привязана к Ethereum. Иначе у монеты было бы «время блока 0,25 с».
    for (const l2 of ["arbitrum", "optimism", "base"]) {
      expect(SEED_CARDS.some((r) => r.chain === l2), l2).toBe(false);
    }
  });

  it("ключ сети принадлежит ровно одной семье", () => {
    // Реестр EVM разбирает алиасы («eth», «bnb», «matic»), поэтому пересечение
    // с ключами других семей проверяется тестом, а не доверием.
    for (const row of SEED_CARDS) {
      const families = [
        resolveSubstrateChain(row.chain) ? "SUBSTRATE" : null,
        resolveCosmosChain(row.chain) ? "COSMOS" : null,
        resolveBitcoinChain(row.chain) ? "BITCOIN" : null,
        resolveEvmChain(row.chain) ? "EVM" : null,
      ].filter(Boolean);
      expect(families, row.chain).toHaveLength(1);
    }
  });

  it("Taler не сеется: его карточку завёл сам проект", () => {
    expect(SEED_CARDS.some((r) => r.chain === "taler")).toBe(false);
  });
});

describe("plannedCard", () => {
  const coin = { id: "celestia", slug: "celestia", name: "Celestia", symbol: "tia" };
  const at = new Date("2026-11-09T10:00:00Z");

  it("карточка скрыта, без владельца и с тикером в верхнем регистре", () => {
    const card = plannedCard(coin, "celestia", at);
    expect(card).toEqual({
      slug: "celestia",
      coinId: "celestia",
      name: "Celestia",
      symbol: "TIA",
      nativeChain: "celestia",
      status: "PENDING",
      trust: "UNVERIFIED",
      provenance: {
        contracts: { kind: "ADMIN_SET", source: "seed", at: "2026-11-09T10:00:00.000Z" },
      },
    });
  });

  it("ни описания, ни ссылок: заявлений проекта у посеянной карточки нет", () => {
    const card = plannedCard(coin, "celestia", at) as Record<string, unknown>;
    for (const field of ["description", "tagline", "links", "tokenomics", "payments", "logoUrl"]) {
      expect(card[field]).toBeUndefined();
    }
  });

  it("сеть не из реестра — отказ, а не карточка в никуда", () => {
    expect(() => plannedCard(coin, "solana", at)).toThrow("unknown_chain:solana");
  });
});
