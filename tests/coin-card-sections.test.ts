import { describe, expect, it } from "vitest";
import { normalizeSectionPayload, sectionValues, MAX_CONTRACTS } from "@/lib/coin-card-sections";

const current = {
  name: "Trientes Coin",
  symbol: "TRI",
  tagline: null,
  description: null,
  logoUrl: null,
  launchDate: null,
  tags: [] as string[],
  links: { website: "https://trientes.org" },
  tokenomics: null,
  security: null,
  teamInfo: null,
  marketing: null,
  contracts: [],
  markets: [],
};

describe("normalizeSectionPayload", () => {
  it("normalizes IDENTITY and reports touched paths", () => {
    const r = normalizeSectionPayload("IDENTITY", { name: "  New Name ", symbol: "tri" }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.card.name).toBe("New Name");
    expect(r.patch.card.symbol).toBe("TRI");
    expect(r.patch.touched).toContain("name");
  });

  it("rejects a bad ticker", () => {
    const r = normalizeSectionPayload("IDENTITY", { symbol: "T R I" }, current);
    expect(r).toEqual({ ok: false, reason: "symbol_invalid" });
  });

  it("lowercases EVM contract addresses and keeps the canonical flag", () => {
    const addr = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const r = normalizeSectionPayload(
      "CONTRACTS",
      { contracts: [{ chain: "ethereum", address: addr, isCanonical: true }] },
      current,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.contracts?.[0].address).toBe(addr.toLowerCase());
    expect(r.patch.contracts?.[0].isCanonical).toBe(true);
    // Слайс S: раздел контрактов владеет и нативной сетью монеты.
    expect(r.patch.touched).toEqual(["contracts", "nativeChain"]);
    expect(r.patch.card.nativeChain).toBeNull();
  });

  it("caps the contract count", () => {
    const contracts = new Array(MAX_CONTRACTS + 1).fill(null).map((_, i) => ({
      chain: "ethereum",
      address: `0x${String(i).padStart(40, "0")}`,
    }));
    const r = normalizeSectionPayload("CONTRACTS", { contracts }, current);
    expect(r).toEqual({ ok: false, reason: "too_many_contracts" });
  });

  it("rejects inconsistent supply", () => {
    const r = normalizeSectionPayload(
      "TOKENOMICS",
      { tokenomics: { circulating: 10, total: 5 } },
      current,
    );
    expect(r).toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("нормализует адреса исключений и отбрасывает дубликаты", () => {
    const addr = "0x" + "A".repeat(40);
    const r = normalizeSectionPayload(
      "TOKENOMICS",
      {
        tokenomics: {
          excluded: [
            { address: addr, label: " Казна " },
            { address: addr.toLowerCase(), label: "Она же" },
          ],
        },
      },
      current,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.patch.card.tokenomics as { excluded: unknown }).excluded).toEqual([
        { address: addr.toLowerCase(), label: "Казна" },
      ]);
    }
  });

  it("не принимает мусор вместо адреса исключения", () => {
    const r = normalizeSectionPayload(
      "TOKENOMICS",
      { tokenomics: { excluded: [{ address: "0x123", label: "Казна" }] } },
      current,
    );
    expect(r).toEqual({ ok: false, reason: "address_invalid" });
  });

  it("не принимает аллокацию больше ста процентов и битый разлок", () => {
    expect(
      normalizeSectionPayload(
        "TOKENOMICS",
        { tokenomics: { allocation: [{ label: "Всё", pct: 60 }, { label: "И ещё", pct: 50 }] } },
        current,
      ),
    ).toEqual({ ok: false, reason: "allocation_over_100" });

    expect(
      normalizeSectionPayload(
        "TOKENOMICS",
        { tokenomics: { unlocks: [{ date: "2026-12-01", label: "Без объёма" }] } },
        current,
      ),
    ).toEqual({ ok: false, reason: "unlock_invalid" });
  });

  it("сохраняет разлоки отсортированными", () => {
    const r = normalizeSectionPayload(
      "TOKENOMICS",
      {
        tokenomics: {
          unlocks: [
            { date: "2027-01-01", label: "Второй", pct: 1 },
            { date: "2026-12-01", label: "Первый", pct: 1 },
          ],
        },
      },
      current,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unlocks = (r.patch.card.tokenomics as { unlocks: Array<{ label: string }> }).unlocks;
      expect(unlocks.map((u) => u.label)).toEqual(["Первый", "Второй"]);
    }
  });

  it("requires a website in LINKS and rejects javascript: urls", () => {
    expect(normalizeSectionPayload("LINKS", { links: {} }, current)).toEqual({
      ok: false,
      reason: "website_required",
    });
    expect(
      normalizeSectionPayload("LINKS", { links: { website: "javascript:alert(1)" } }, current),
    ).toEqual({ ok: false, reason: "url_invalid" });
  });

  it("refuses an unknown section", () => {
    const r = normalizeSectionPayload("ACCEPTANCE", {}, current);
    expect(r).toEqual({ ok: false, reason: "section_unsupported" });
  });
});

describe("sectionValues", () => {
  it("reads the current value of every path the section owns", () => {
    expect(sectionValues("IDENTITY", current).name).toBe("Trientes Coin");
    expect(sectionValues("LINKS", current).links).toEqual({ website: "https://trientes.org" });
    expect(sectionValues("CONTRACTS", current).contracts).toEqual([]);
  });
});

describe("normalizeSectionPayload — нативная сеть (слайс S)", () => {
  it("принимает сеть из реестра и приводит ключ к нижнему регистру", () => {
    const r = normalizeSectionPayload("CONTRACTS", { contracts: [], nativeChain: "Taler" }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.card.nativeChain).toBe("taler");
  });

  it("сеть вне реестра отбрасывается: карточка не должна ссылаться на нечитаемую цепь", () => {
    const r = normalizeSectionPayload("CONTRACTS", { contracts: [], nativeChain: "mystery" }, current);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("chain_unknown");
  });

  it("пустая строка значит «монета живёт токеном в чужой сети»", () => {
    const r = normalizeSectionPayload("CONTRACTS", { contracts: [], nativeChain: "  " }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.card.nativeChain).toBeNull();
  });
});
