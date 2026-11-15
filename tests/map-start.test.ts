import { describe, expect, it } from "vitest";
import { MAP_FALLBACK_CENTER, MAP_FALLBACK_ZOOM, shouldAutoLocate } from "@/lib/map-start";

describe("MAP_FALLBACK_CENTER", () => {
  it("это Мадрид, а не Прага", () => {
    const [lon, lat] = MAP_FALLBACK_CENTER;
    expect(lon).toBeCloseTo(-3.7038, 2);
    expect(lat).toBeCloseTo(40.4168, 2);
  });

  it("приближение городское: страна целиком — это не «где я»", () => {
    expect(MAP_FALLBACK_ZOOM).toBeGreaterThanOrEqual(10);
    expect(MAP_FALLBACK_ZOOM).toBeLessThanOrEqual(14);
  });
});

describe("shouldAutoLocate", () => {
  it("разрешено — спрашиваем сразу, ни одного окна человек не увидит", () => {
    expect(shouldAutoLocate("granted")).toBe(true);
  });

  it("ещё не спрашивали — спрашиваем: за этим в навигатор и заходят", () => {
    expect(shouldAutoLocate("prompt")).toBe(true);
  });

  it("браузер без Permissions API не повод не пробовать", () => {
    expect(shouldAutoLocate("unknown")).toBe(true);
  });

  it("отказ — это ответ: второй отказ браузер запоминает навсегда", () => {
    expect(shouldAutoLocate("denied")).toBe(false);
  });
});
