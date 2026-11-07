import { describe, expect, it } from "vitest";
import {
  SECTION_SPECS,
  getPath,
  setPath,
  specToInitial,
  stateToPayload,
} from "@/lib/coin-card-form-spec";

describe("getPath / setPath", () => {
  it("reads a nested path", () => {
    expect(getPath({ tokenomics: { circulating: 7 } }, "tokenomics.circulating")).toBe(7);
  });

  it("returns undefined for a missing branch", () => {
    expect(getPath({}, "security.audits")).toBeUndefined();
  });

  it("creates intermediate objects when writing", () => {
    const out = {};
    setPath(out, "tokenomics.max", 10);
    expect(out).toEqual({ tokenomics: { max: 10 } });
  });
});

describe("specToInitial", () => {
  it("prefills scalars, line blocks and row groups from the card", () => {
    const init = specToInitial(SECTION_SPECS.TOKENOMICS, {
      tokenomics: {
        circulating: 1000,
        excluded: [{ address: "0xa", label: "treasury" }],
        emission: "fixed",
      },
    });
    expect(init["tokenomics.circulating"]).toBe("1000");
    expect(
      (init["tokenomics.excluded"] as Record<string, unknown>[])[0],
    ).toEqual({ address: "0xa", label: "treasury" });
    expect(init["tokenomics.emission"]).toBe("fixed");
  });

  it("prefills a row group as an array of row objects", () => {
    const init = specToInitial(SECTION_SPECS.CONTRACTS, {
      contracts: [{ chain: "ethereum", address: "0xa", decimals: 18, isCanonical: true }],
    });
    expect(Array.isArray(init.contracts)).toBe(true);
    expect((init.contracts as Record<string, unknown>[])[0].address).toBe("0xa");
  });

  it("gives an empty string for a missing scalar, never undefined", () => {
    expect(specToInitial(SECTION_SPECS.IDENTITY, {}).tagline).toBe("");
  });
});

describe("stateToPayload", () => {
  it("casts numbers and drops blanks", () => {
    const p = stateToPayload(SECTION_SPECS.TOKENOMICS, {
      "tokenomics.circulating": "1000",
      "tokenomics.total": "",
      "tokenomics.excluded": [
        { address: " 0xa ", label: "treasury" },
        { address: "", label: "" },
      ],
      "tokenomics.emission": " fixed ",
    });
    const t = (p.tokenomics ?? {}) as Record<string, unknown>;
    expect(t.circulating).toBe(1000);
    expect(t.total).toBeNull();
    // Пустая строка формы отбрасывается ещё на уровне payload.
    expect(t.excluded).toEqual([{ address: "0xa", label: "treasury" }]);
    expect(t.emission).toBe("fixed");
  });

  it("keeps booleans as booleans", () => {
    const p = stateToPayload(SECTION_SPECS.SECURITY, { "security.teamDoxxed": true });
    expect((p.security as Record<string, unknown>).teamDoxxed).toBe(true);
  });

  it("drops fully blank rows from a row group", () => {
    const p = stateToPayload(SECTION_SPECS.CONTRACTS, {
      contracts: [
        { chain: "ethereum", address: "0xa", decimals: "18", standard: "", explorerUrl: "", isCanonical: true },
        { chain: "ethereum", address: "", decimals: "", standard: "", explorerUrl: "", isCanonical: false },
      ],
    });
    expect(p.contracts).toHaveLength(1);
    expect((p.contracts as Record<string, unknown>[])[0].decimals).toBe(18);
  });

  it("splits tags on commas", () => {
    const p = stateToPayload(SECTION_SPECS.IDENTITY, { tags: "defi, l2 , " });
    expect(p.tags).toEqual(["defi", "l2"]);
  });
});
