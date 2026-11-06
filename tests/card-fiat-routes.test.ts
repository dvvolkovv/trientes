import { describe, expect, it } from "vitest";
import {
  FIAT_ROUTE_LIMIT,
  type FiatRouteRow,
  rankFiatRoutes,
} from "@/lib/card-fiat-routes";

function row(i: number, services: string[], extra: Partial<FiatRouteRow> = {}): FiatRouteRow {
  return {
    id: `f${i}`,
    slug: `svc-${i}`,
    displayName: `Service ${i}`,
    logoUrl: null,
    services,
    availableIn: ["AT"],
    supportedFiats: ["EUR"],
    kycLevel: "BASIC",
    feesSummary: null,
    ...extra,
  };
}

describe("rankFiatRoutes", () => {
  it("returns an honest empty result when nobody serves the coin", () => {
    const r = rankFiatRoutes([]);
    expect(r.rows).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(r.byService).toEqual([]);
  });

  it("puts off-ramp and payments services first — that is what a merchant needs", () => {
    const r = rankFiatRoutes([
      row(1, ["STAKING"]),
      row(2, ["OFFRAMP"]),
      row(3, ["CUSTODY"]),
      row(4, ["PAYMENTS"]),
    ]);
    expect(r.rows.slice(0, 2).map((x) => x.id).sort()).toEqual(["f2", "f4"]);
  });

  it("breaks ties by name so the order does not jitter between requests", () => {
    const r = rankFiatRoutes([
      row(2, ["OFFRAMP"], { displayName: "Bravo" }),
      row(1, ["OFFRAMP"], { displayName: "Alpha" }),
    ]);
    expect(r.rows.map((x) => x.displayName)).toEqual(["Alpha", "Bravo"]);
  });

  it("counts services across every row, not only the shown ones", () => {
    const many = Array.from({ length: FIAT_ROUTE_LIMIT + 3 }, (_, i) => row(i, ["OFFRAMP"]));
    const r = rankFiatRoutes(many);
    expect(r.rows).toHaveLength(FIAT_ROUTE_LIMIT);
    expect(r.hasMore).toBe(true);
    expect(r.byService).toEqual([{ service: "OFFRAMP", count: FIAT_ROUTE_LIMIT + 3 }]);
  });

  it("collects the union of countries and fiats across services", () => {
    const r = rankFiatRoutes([
      row(1, ["OFFRAMP"], { availableIn: ["AT", "DE"], supportedFiats: ["EUR"] }),
      row(2, ["ONRAMP"], { availableIn: ["DE", "PL"], supportedFiats: ["PLN", "EUR"] }),
    ]);
    expect(r.countries).toEqual(["AT", "DE", "PL"]);
    expect(r.fiats).toEqual(["EUR", "PLN"]);
  });
});
