import { describe, expect, it } from "vitest";
import {
  getProvenance,
  markSelfReported,
  mergeProvenance,
  type ProvenanceMap,
} from "@/lib/coin-card-provenance";

const AT = new Date("2026-11-06T10:00:00.000Z");

describe("markSelfReported", () => {
  it("stamps every changed path as self-reported", () => {
    const m = markSelfReported({}, ["tokenomics.circulating", "links.website"], AT);
    expect(m["tokenomics.circulating"]).toEqual({
      kind: "SELF_REPORTED", source: null, at: AT.toISOString(),
    });
    expect(Object.keys(m)).toHaveLength(2);
  });

  it("does not touch paths it was not given", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = markSelfReported(base, ["links.website"], AT);
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });
});

describe("mergeProvenance", () => {
  it("lets a stronger source overwrite a weaker one", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "SELF_REPORTED", source: null, at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    });
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("does not let a weaker source downgrade a verified value", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      "tokenomics.total": { kind: "SELF_REPORTED", source: null, at: AT.toISOString() },
    });
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("lets ADMIN_SET override anything", () => {
    const base: ProvenanceMap = {
      symbol: { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      symbol: { kind: "ADMIN_SET", source: "moderator", at: AT.toISOString() },
    });
    expect(m.symbol.kind).toBe("ADMIN_SET");
  });
});

describe("getProvenance", () => {
  it("defaults unknown paths to self-reported", () => {
    expect(getProvenance(null, "links.website").kind).toBe("SELF_REPORTED");
  });

  it("survives a malformed JSONB blob", () => {
    expect(getProvenance("not an object" as unknown as ProvenanceMap, "x").kind)
      .toBe("SELF_REPORTED");
  });
});
