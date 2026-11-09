import { describe, expect, it } from "vitest";
import { chainFamily, plannedCard, SEED_CARDS } from "../src/lib/coin-card-seed";

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

  it("в пилоте восемнадцать монет: девять Substrate и девять Cosmos", () => {
    expect(SEED_CARDS).toHaveLength(18);
    const byFamily = SEED_CARDS.map((r) => chainFamily(r.chain));
    expect(byFamily.filter((f) => f === "SUBSTRATE")).toHaveLength(9);
    expect(byFamily.filter((f) => f === "COSMOS")).toHaveLength(9);
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
