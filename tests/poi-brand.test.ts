import { describe, it, expect } from "vitest";
import {
  poiBrand,
  poiPulseColor,
  pulseFrame,
  BRAND_COLOR,
  FUEL_PULSE,
} from "@/lib/poi-brand";
import { LAYER_COLOR } from "@/lib/poi-layers";

describe("каёмка — кто стоит за точкой", () => {
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

  it("три цвета каёмки, и все разные", () => {
    expect(new Set(Object.values(BRAND_COLOR)).size).toBe(3);
  });
});

describe("пульс — что это за место", () => {
  it("деньги пульсируют оранжевым: банкомат, банк, финтех", () => {
    for (const layer of ["atm", "financial", "fintech"] as const) {
      expect(poiPulseColor({ layer })).toBe("#FE5C04");
    }
  });

  it("магазин — зелёным", () => {
    expect(poiPulseColor({ layer: "merchant", category: "Bakery" })).toBe(LAYER_COLOR.merchant);
  });

  it("заправка — синим: категория сильнее слоя", () => {
    // В OSM заправка это amenity=fuel, то есть у нас она приходит «магазином».
    expect(poiPulseColor({ layer: "merchant", category: "Fuel" })).toBe(FUEL_PULSE);
    expect(poiPulseColor({ layer: "merchant", category: "Charging Station" })).toBe(FUEL_PULSE);
  });

  it("слово внутри другого слова заправкой не делает", () => {
    expect(poiPulseColor({ layer: "merchant", category: "Fuelled Coffee" })).toBe(
      LAYER_COLOR.merchant,
    );
  });

  it("каёмка банкомата нашего предприятия оранжевая, и пульс тоже — это не ошибка", () => {
    // Два знака совпали по цвету только потому, что оба про одно и то же
    // заведение; читаются они всё равно раздельно (кольцо и середина).
    expect(BRAND_COLOR[poiBrand({ id: "company/x", layer: "atm" })]).toBe("#FE5C04");
    expect(poiPulseColor({ layer: "atm" })).toBe("#FE5C04");
  });
});

describe("дыхание пульса", () => {
  it("в начале и в конце цикла точка самая маленькая и яркая", () => {
    const a = pulseFrame(0);
    const b = pulseFrame(1);
    expect(a).toEqual(b);
    expect(a.opacity).toBeCloseTo(1, 5);
  });

  it("в середине цикла — самая крупная и приглушённая", () => {
    const mid = pulseFrame(0.5);
    expect(mid.radius).toBeGreaterThan(pulseFrame(0).radius);
    expect(mid.opacity).toBeLessThan(pulseFrame(0).opacity);
  });

  it("радиус и прозрачность не выходят за разумные пределы", () => {
    for (let i = 0; i <= 20; i++) {
      const f = pulseFrame(i / 20);
      expect(f.radius).toBeGreaterThan(1.5);
      expect(f.radius).toBeLessThan(5);
      expect(f.opacity).toBeGreaterThan(0.5);
      expect(f.opacity).toBeLessThanOrEqual(1);
    }
  });
});
