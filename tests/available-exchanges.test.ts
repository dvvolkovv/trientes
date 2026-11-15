import { describe, expect, it } from "vitest";
import { availableExchangesCacheKey, countryNamesForCode } from "@/lib/available-exchanges";

describe("countryNamesForCode", () => {
  it("returns the ISO name of the country", () => {
    expect(countryNamesForCode("AT")).toContain("Austria");
    expect(countryNamesForCode("at")).toContain("Austria");
  });

  // Живой прогон по базе: из 59 написаний каталога имя не нашлось у трёх, и
  // «Turkey» — единственное, что является страной; оно и лечится псевдонимом.
  it("knows the catalogue spellings that differ from the ISO list", () => {
    expect(countryNamesForCode("TR")).toContain("Turkey");
    expect(countryNamesForCode("TR")).toContain("Türkiye");
  });

  it("returns nothing for a code that is not a country", () => {
    expect(countryNamesForCode("ZZ")).toEqual([]);
  });

  it("keys the cache per country", () => {
    expect(availableExchangesCacheKey("at")).toBe("exchange:country:AT");
  });
});
