import { describe, expect, it } from "vitest";
import { placeQueryOrder } from "@/lib/geocode-place";

describe("placeQueryOrder", () => {
  it("спрашивает название с адресом, потом один адрес", () => {
    // Живой случай: «ALTA Invest GmbH, Brehmstraße 19, 1020 Wien» Nominatim не
    // знает, а адрес без названия находит — без второго кандидата булавка не
    // ставилась вовсе.
    expect(placeQueryOrder("ALTA Invest GmbH", "Brehmstraße 19, 1020 Wien")).toEqual([
      "ALTA Invest GmbH, Brehmstraße 19, 1020 Wien",
      "Brehmstraße 19, 1020 Wien",
      "ALTA Invest GmbH",
    ]);
  });

  it("одно поле — один кандидат", () => {
    expect(placeQueryOrder("", "Bahnhofplatz 10, 9100 Herisau")).toEqual(["Bahnhofplatz 10, 9100 Herisau"]);
    expect(placeQueryOrder("Hotel Sacher", "")).toEqual(["Hotel Sacher"]);
  });

  it("повтор и слишком короткое не спрашиваются", () => {
    // Название, дословно повторяющее адрес, дало бы два одинаковых запроса.
    expect(placeQueryOrder("Wien", "Wien")).toEqual(["Wien, Wien", "Wien"]);
    expect(placeQueryOrder("", "ул")).toEqual([]);
    expect(placeQueryOrder("  ", "  ")).toEqual([]);
  });
});
