import { describe, it, expect } from "vitest";
import { poiBrand, BRAND_COLOR, BRAND_RING } from "@/lib/poi-brand";

describe("кто стоит за точкой", () => {
  it("точка нашего предприятия — своя", () => {
    expect(poiBrand({ id: "company/abc", layer: "merchant" })).toBe("own");
    expect(poiBrand({ id: "company/abc", layer: "atm" })).toBe("own");
  });

  it("точка каталога финтеха — учреждение", () => {
    expect(poiBrand({ id: "fintech/abc", layer: "fintech" })).toBe("institution");
  });

  it("банк из зеркала BTC Map остаётся зеркалом, а не учреждением", () => {
    // Правило — про источник, а не про вывеску: о банке, пришедшем из OSM, мы
    // знаем ровно столько же, сколько о любой другой чужой точке.
    expect(poiBrand({ id: "node/123", layer: "financial" })).toBe("osm");
    expect(poiBrand({ id: "way/9", layer: "merchant" })).toBe("osm");
  });
});

describe("палитра", () => {
  it("три цвета, и все разные", () => {
    const values = Object.values(BRAND_COLOR);
    expect(new Set(values).size).toBe(3);
  });

  it("на оранжевой заливке кольцо белое, иначе оранжевое", () => {
    expect(BRAND_RING.own).toBe("#FFFFFF");
    expect(BRAND_RING.osm).toBe(BRAND_COLOR.own);
    expect(BRAND_RING.institution).toBe(BRAND_COLOR.own);
  });
});
