import { describe, expect, it } from "vitest";
import { buildDiff, diffPaths, diffToCardUpdate } from "@/lib/coin-card-diff";

describe("buildDiff", () => {
  it("records only changed paths", () => {
    const d = buildDiff({ name: "A", symbol: "TRI" }, { name: "B", symbol: "TRI" });
    expect(d).toEqual([{ path: "name", before: "A", after: "B" }]);
  });

  it("treats deep-equal objects as unchanged", () => {
    const d = buildDiff(
      { links: { website: "https://a.io", x: "https://x.com/a" } },
      { links: { x: "https://x.com/a", website: "https://a.io" } },
    );
    expect(d).toEqual([]);
  });

  it("compares Date against its ISO string without a false positive", () => {
    const at = new Date("2026-01-02T00:00:00.000Z");
    expect(buildDiff({ launchDate: at }, { launchDate: at.toISOString() })).toEqual([]);
  });

  it("diffs child arrays wholesale", () => {
    const before = { contracts: [{ chain: "ethereum", address: "0xa" }] };
    const after = { contracts: [{ chain: "ethereum", address: "0xb" }] };
    expect(diffPaths(buildDiff(before, after))).toEqual(["contracts"]);
  });

  it("ignores undefined in the after map — the section did not touch it", () => {
    expect(buildDiff({ tagline: "x" }, { tagline: undefined })).toEqual([]);
  });
});

describe("diffToCardUpdate", () => {
  it("splits scalar columns from child tables", () => {
    const u = diffToCardUpdate([
      { path: "name", before: "A", after: "B" },
      { path: "contracts", before: [], after: [{ chain: "ethereum", address: "0xb" }] },
      { path: "markets", before: [], after: [{ kind: "CEX", exchangeName: "X", pair: "TRI/USDT" }] },
    ]);
    expect(u.data).toEqual({ name: "B" });
    expect(u.contracts).toHaveLength(1);
    expect(u.markets).toHaveLength(1);
  });

  it("revives launchDate back into a Date for Prisma", () => {
    const u = diffToCardUpdate([
      { path: "launchDate", before: null, after: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(u.data.launchDate).toBeInstanceOf(Date);
  });

  it("keeps a null launchDate null", () => {
    const u = diffToCardUpdate([{ path: "launchDate", before: "2026-01-02", after: null }]);
    expect(u.data.launchDate).toBeNull();
  });
});
