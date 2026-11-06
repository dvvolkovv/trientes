import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_PREVIEW,
  ACCEPTANCE_TOP_COUNTRIES,
  aggregateAcceptance,
  type AcceptanceRow,
} from "@/lib/coin-card-acceptance";

function row(i: number, countryCode: string | null, type: AcceptanceRow["type"]): AcceptanceRow {
  return { id: `p${i}`, name: `Point ${i}`, city: "Prague", countryCode, type, lat: 50, lon: 14 };
}

describe("aggregateAcceptance", () => {
  it("returns an honest zero for no points", () => {
    const s = aggregateAcceptance([], 0);
    expect(s.total).toBe(0);
    expect(s.countries).toBe(0);
    expect(s.byCountry).toEqual([]);
    expect(s.byType).toEqual([]);
    expect(s.recent).toEqual([]);
  });

  it("counts countries and types, most frequent first", () => {
    const s = aggregateAcceptance(
      [row(1, "CZ", "SHOP"), row(2, "CZ", "ATM"), row(3, "PL", "SHOP"), row(4, "CZ", "SHOP")],
      4,
    );
    expect(s.total).toBe(4);
    expect(s.countries).toBe(2);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 3 }, { code: "PL", count: 1 }]);
    expect(s.byType).toEqual([{ type: "SHOP", count: 3 }, { type: "ATM", count: 1 }]);
  });

  it("trusts the caller's total over the row count (rows are capped)", () => {
    const s = aggregateAcceptance([row(1, "CZ", "SHOP")], 900);
    expect(s.total).toBe(900);
  });

  it("ignores points with no country in the breakdown but keeps them in the total", () => {
    const s = aggregateAcceptance([row(1, null, "ONLINE"), row(2, "CZ", "SHOP")], 2);
    expect(s.total).toBe(2);
    expect(s.countries).toBe(1);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 1 }]);
  });

  it("caps the country breakdown and the preview list", () => {
    const codes = ["AA","BB","CC","DD","EE","FF","GG","HH","II","JJ","KK","LL"];
    const rows = codes.map((c, i) => row(i, c, "SHOP"));
    const s = aggregateAcceptance(rows, rows.length);
    expect(s.byCountry).toHaveLength(ACCEPTANCE_TOP_COUNTRIES);
    expect(s.recent).toHaveLength(ACCEPTANCE_PREVIEW);
    expect(s.recent[0].id).toBe("p0");
    expect(s.countries).toBe(12);
  });

  it("breaks country ties by code so the order is stable", () => {
    const s = aggregateAcceptance([row(1, "PL", "SHOP"), row(2, "CZ", "SHOP")], 2);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 1 }, { code: "PL", count: 1 }]);
  });
});
