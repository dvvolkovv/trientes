import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_PREVIEW,
  ACCEPTANCE_TOP_COUNTRIES,
  aggregateAcceptance,
  areaOf,
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

describe("areaOf", () => {
  function at(i: number, lat: number | null, lon: number | null): AcceptanceRow {
    return { id: `p${i}`, name: `Point ${i}`, city: null, countryCode: "CH", type: "SHOP", lat, lon };
  }

  it("без координат обещать место нечем", () => {
    // Точка «онлайн» живёт без координат: карта её не покажет никогда.
    expect(areaOf([at(1, null, null)])).toBeNull();
    expect(areaOf([])).toBeNull();
  });

  it("одна точка — прямоугольник в ноль: камера встанет ровно на ней", () => {
    expect(areaOf([at(1, 47.39, 9.2773)])).toEqual({
      minLat: 47.39, maxLat: 47.39, minLon: 9.2773, maxLon: 9.2773,
    });
  });

  it("несколько точек — прямоугольник по крайним, а не по первой", () => {
    expect(areaOf([at(1, 50, 14), at(2, 47.39, 9.2773), at(3, 52, 21)])).toEqual({
      minLat: 47.39, maxLat: 52, minLon: 9.2773, maxLon: 21,
    });
  });

  it("точка без координат не тянет прямоугольник в ноль широты", () => {
    // Иначе одна «онлайн»-точка увела бы карту в Гвинейский залив.
    expect(areaOf([at(1, 47.39, 9.2773), at(2, null, null)])).toEqual({
      minLat: 47.39, maxLat: 47.39, minLon: 9.2773, maxLon: 9.2773,
    });
  });
});

describe("aggregateAcceptance: прямоугольник точек", () => {
  it("считается по всей выборке, а не по шести строкам превью", () => {
    // Превью — шесть строк, а на карте человек должен увидеть все точки.
    const rows: AcceptanceRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, city: null, countryCode: "CH", type: "SHOP",
      lat: 40 + i, lon: 10 + i,
    }));
    const s = aggregateAcceptance(rows, 8);
    expect(s.recent).toHaveLength(ACCEPTANCE_PREVIEW);
    expect(s.area).toEqual({ minLat: 40, maxLat: 47, minLon: 10, maxLon: 17 });
  });

  it("нет точек — нет прямоугольника", () => {
    expect(aggregateAcceptance([], 0).area).toBeNull();
  });
});
