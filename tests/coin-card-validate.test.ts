import { describe, expect, it } from "vitest";
import {
  validateCardBasics,
  validateContract,
  validateTokenomics,
  normalizeHttpUrl,
} from "@/lib/coin-card-validate";

describe("validateCardBasics", () => {
  it("accepts a minimal valid card and normalizes fields", () => {
    const r = validateCardBasics({
      name: "  Foobar Chain  ",
      symbol: " foo ",
      tagline: " Fast L1 ",
      description: "A chain for testing purposes.",
      website: "foobar.org",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.data.name).toBe("Foobar Chain");
      expect(r.data.symbol).toBe("FOO");
      expect(r.data.tagline).toBe("Fast L1");
      expect(r.data.website).toBe("https://foobar.org");
    }
  });

  it("requires a name", () => {
    expect(validateCardBasics({ name: " ", symbol: "FOO", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "name_required" });
  });

  it("requires a symbol", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_required" });
  });

  it("rejects an over-long symbol", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "ABCDEFGHIJKLM", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_too_long" });
  });

  it("rejects a symbol with punctuation", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FO O", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_invalid" });
  });

  it("rejects an over-long tagline", () => {
    expect(validateCardBasics({
      name: "Foo", symbol: "FOO", website: "https://a.io", tagline: "x".repeat(121),
    })).toEqual({ ok: false, reason: "tagline_too_long" });
  });

  it("requires a website", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FOO", website: " " }))
      .toEqual({ ok: false, reason: "website_required" });
  });

  it("rejects a javascript: website", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FOO", website: "javascript:alert(1)" }))
      .toEqual({ ok: false, reason: "url_invalid" });
  });
});

describe("normalizeHttpUrl", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com");
  });

  it("keeps an explicit http url", () => {
    expect(normalizeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("returns null for empty input", () => {
    expect(normalizeHttpUrl("  ")).toBeNull();
  });

  it("returns 'invalid' for non-http schemes", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toBe("invalid");
    expect(normalizeHttpUrl("data:text/html,x")).toBe("invalid");
  });
});

describe("validateContract", () => {
  it("accepts a checksummed EVM address and lowercases it", () => {
    const r = validateContract({
      chain: "ethereum",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.data.address).toBe("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599");
  });

  it("rejects a malformed EVM address", () => {
    expect(validateContract({ chain: "ethereum", address: "0xdeadbeef" }))
      .toEqual({ ok: false, reason: "contract_invalid" });
  });

  it("accepts a base58 Solana mint", () => {
    expect(validateContract({
      chain: "solana",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    })).toMatchObject({ ok: true });
  });

  it("rejects an unknown chain", () => {
    expect(validateContract({ chain: "atlantis", address: "0x0" }))
      .toEqual({ ok: false, reason: "chain_unknown" });
  });

  it("rejects negative or absurd decimals", () => {
    const addr = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
    expect(validateContract({ chain: "ethereum", address: addr, decimals: -1 }))
      .toEqual({ ok: false, reason: "decimals_invalid" });
    expect(validateContract({ chain: "ethereum", address: addr, decimals: 100 }))
      .toEqual({ ok: false, reason: "decimals_invalid" });
  });

  it("rejects a javascript: explorer link", () => {
    expect(validateContract({
      chain: "ethereum",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      explorerUrl: "javascript:alert(1)",
    })).toEqual({ ok: false, reason: "url_invalid" });
  });
});

describe("validateTokenomics", () => {
  it("accepts a consistent supply triple", () => {
    expect(validateTokenomics({ circulating: 1000, total: 2000, max: 3000 }))
      .toMatchObject({ ok: true });
  });

  it("accepts partially filled supply", () => {
    expect(validateTokenomics({ circulating: 1000 })).toMatchObject({ ok: true });
    expect(validateTokenomics({})).toMatchObject({ ok: true });
  });

  it("rejects circulating greater than total", () => {
    expect(validateTokenomics({ circulating: 3000, total: 2000 }))
      .toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("rejects total greater than max", () => {
    expect(validateTokenomics({ total: 4000, max: 3000 }))
      .toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("rejects negative supply", () => {
    expect(validateTokenomics({ circulating: -1 }))
      .toEqual({ ok: false, reason: "supply_negative" });
  });
});
