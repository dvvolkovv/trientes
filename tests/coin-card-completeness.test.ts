import { describe, expect, it } from "vitest";
import {
  computeCompleteness,
  missingFields,
  COMPLETENESS_TOTAL_WEIGHT,
} from "@/lib/coin-card-completeness";

const EMPTY = { name: "", symbol: "" };

const FULL = {
  name: "Foobar Chain",
  symbol: "FOO",
  tagline: "Fast L1",
  description: "x".repeat(300),
  logoUrl: "/uploads/coin-cards/a/b.png",
  launchDate: new Date("2024-01-01"),
  tags: ["l1"],
  links: {
    website: "https://foobar.org", docs: "https://d.foobar.org",
    whitepaper: "https://foobar.org/wp.pdf", github: "https://github.com/foobar",
    x: "https://x.com/foobar", telegram: "https://t.me/foobar",
  },
  tokenomics: {
    circulating: 1, total: 2, max: 3, excludedAddresses: ["0x1"], emission: "fixed",
    allocation: [{ label: "Команда", pct: 20 }],
    unlocks: [{ date: "2026-12-01", label: "Транш 1", pct: 2 }],
  },
  security: {
    audits: [{ firm: "Zellic", reportUrl: "https://z.io/r" }],
    riskFlags: { mintable: false }, teamDoxxed: true, legalEntity: "Foobar Labs OU",
  },
  teamInfo: { members: [{ name: "A", role: "CEO" }], investors: ["X Capital"] },
  marketing: { pitch: "y".repeat(200), roadmap: [{ title: "Mainnet", date: "2024-06" }], mediaKit: "https://foobar.org/kit" },
  contracts: [{ chain: "ethereum", address: "0x" + "1".repeat(40), decimals: 18 }],
  markets: [{ kind: "CEX", exchangeName: "Binance", pair: "FOO/USDT" }],
};

describe("computeCompleteness", () => {
  it("is 0 for an empty card", () => {
    expect(computeCompleteness(EMPTY)).toBe(0);
  });

  it("is 100 for a fully filled card", () => {
    expect(computeCompleteness(FULL)).toBe(100);
  });

  it("never leaves the 0..100 range", () => {
    const v = computeCompleteness({ ...FULL, tags: [], markets: [] });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("is monotonic: adding a field never lowers the score", () => {
    const before = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const after = computeCompleteness({ name: "Foo", symbol: "FOO", tagline: "Fast" });
    expect(after).toBeGreaterThan(before);
  });

  it("ignores blank strings and empty arrays", () => {
    const a = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const b = computeCompleteness({ name: "Foo", symbol: "FOO", tagline: "   ", tags: [] });
    expect(b).toBe(a);
  });

  it("does not credit a too-short description", () => {
    const a = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const b = computeCompleteness({ name: "Foo", symbol: "FOO", description: "short" });
    expect(b).toBe(a);
  });
});

describe("missingFields", () => {
  it("lists what is still missing, for the UI hint", () => {
    const miss = missingFields({ name: "Foo", symbol: "FOO" });
    expect(miss).toContain("logoUrl");
    expect(miss).toContain("contracts");
    expect(miss).not.toContain("name");
  });

  it("is empty for a full card", () => {
    expect(missingFields(FULL)).toEqual([]);
  });
});

describe("weights", () => {
  it("sum to exactly 100 so the score needs no fudging", () => {
    expect(COMPLETENESS_TOTAL_WEIGHT).toBe(100);
  });
});
