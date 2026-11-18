import { describe, it, expect } from "vitest";
import {
  isOsmPoiKey,
  poiIdToOsmKey,
  osmKeyToPoiId,
  claimPrefillFromTags,
  claimBlockedBy,
} from "@/lib/point-claim";

describe("ключ точки зеркала", () => {
  it("принимает три вида объекта OSM", () => {
    expect(isOsmPoiKey("node:123")).toBe(true);
    expect(isOsmPoiKey("way:9778525869")).toBe(true);
    expect(isOsmPoiKey("relation:1")).toBe(true);
  });

  it("отвергает всё прочее", () => {
    for (const k of ["", "node:", "node:abc", "company/abc", "node:12;drop", "point:1"]) {
      expect(isOsmPoiKey(k)).toBe(false);
    }
  });

  it("переводит написание фида в написание зеркала и обратно", () => {
    expect(poiIdToOsmKey("node/123")).toBe("node:123");
    expect(osmKeyToPoiId("node:123")).toBe("node/123");
    expect(poiIdToOsmKey("company/abc")).toBeNull();
    expect(osmKeyToPoiId("node/123")).toBeNull();
  });
});

describe("заполнение формы из тегов OSM", () => {
  it("берёт имя, адрес, часы и связь", () => {
    const p = claimPrefillFromTags({
      name: " Kafe Bitcoin ",
      "addr:country": "cz",
      "addr:city": "Praha",
      "addr:street": "Dlouhá",
      "addr:housenumber": "13",
      "addr:postcode": "110 00",
      opening_hours: "Mo-Fr 08:00-20:00",
      "contact:phone": "+420 111 222 333",
      website: "https://kafe.example",
      "payment:bitcoin": "yes",
    });
    expect(p.type).toBe("SHOP");
    expect(p.name).toBe("Kafe Bitcoin");
    expect(p.countryCode).toBe("CZ");
    expect(p.city).toBe("Praha");
    expect(p.street).toBe("Dlouhá");
    expect(p.houseNumber).toBe("13");
    expect(p.postalCode).toBe("110 00");
    expect(p.openingHours).toBe("Mo-Fr 08:00-20:00");
    expect(p.phone).toBe("+420 111 222 333");
    expect(p.website).toBe("https://kafe.example");
    expect(p.acceptedCoinIds).toEqual(["bitcoin"]);
  });

  it("банкомат узнаётся по тегам, а безымянному ставится имя по типу", () => {
    const p = claimPrefillFromTags({ amenity: "atm", "payment:cryptocurrencies": "yes" });
    expect(p.type).toBe("ATM");
    expect(p.name).toBe("Crypto ATM");
    expect(p.genericCrypto).toBe(true);
    expect(p.acceptedCoinIds).toEqual([]);
  });

  it("негодный адрес сайта не переносится", () => {
    expect(claimPrefillFromTags({ website: "javascript:alert(1)" }).website).toBeNull();
  });

  it("безымянный магазин остаётся без имени — выдумывать его нечем", () => {
    expect(claimPrefillFromTags({ shop: "bakery" }).name).toBe("");
  });
});

describe("можно ли ещё забрать точку", () => {
  it("свободна, пока по ней никто не подавал", () => {
    expect(claimBlockedBy([])).toBeNull();
  });

  it("ожидающая заявка держит точку", () => {
    expect(claimBlockedBy([{ status: "PENDING", deletedAt: null }])).toBe("pending");
  });

  it("одобренная точка уже чья-то", () => {
    expect(claimBlockedBy([{ status: "APPROVED", deletedAt: null }])).toBe("taken");
  });

  it("отклонённая заявка подать заново не мешает", () => {
    expect(claimBlockedBy([{ status: "REJECTED", deletedAt: null }])).toBeNull();
  });

  it("удалённая строка точку не держит", () => {
    expect(claimBlockedBy([{ status: "APPROVED", deletedAt: new Date() }])).toBeNull();
  });
});
