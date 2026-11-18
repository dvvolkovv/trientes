import { describe, expect, it } from "vitest";
import {
  MAP_AREA_PADDING,
  MAP_FALLBACK_CENTER,
  MAP_FALLBACK_ZOOM,
  MAP_FOCUS_ZOOM,
  shouldAutoLocate,
  startView,
} from "@/lib/map-start";

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

describe("startView", () => {
  it("без названной точки — город по умолчанию", () => {
    expect(startView(null)).toEqual({ center: MAP_FALLBACK_CENTER, zoom: MAP_FALLBACK_ZOOM });
  });

  it("названная точка открывается улицей, а не страной", () => {
    const view = startView({ id: "company/x", lat: 47.3900641, lon: 9.2773337 });
    expect(view).toEqual({ center: [9.2773337, 47.3900641], zoom: MAP_FOCUS_ZOOM });
    expect(MAP_FOCUS_ZOOM).toBeGreaterThan(MAP_FALLBACK_ZOOM);
  });
});

describe("shouldAutoLocate с названной точкой", () => {
  it("позвали в место — камеру у него не отнимаем", () => {
    // Иначе ссылка «где именно» показывала бы не магазин, а того, кто её нажал.
    expect(shouldAutoLocate("granted", true)).toBe(false);
    expect(shouldAutoLocate("prompt", true)).toBe(false);
  });

  it("без точки всё как было", () => {
    expect(shouldAutoLocate("granted", false)).toBe(true);
  });
});

describe("startView с прямоугольником точек", () => {
  const area = { minLat: 47.39, maxLat: 47.39, minLon: 9.2773, maxLon: 9.2773 };

  it("карта открывается на точках монеты, а не в городе по умолчанию", () => {
    // Фид точек приходит по кадру карты: открылась в Мадриде — единственная
    // точка в Швейцарии не попадёт в ответ вовсе, и человек увидит пустую Испанию.
    const view = startView(null, area);
    expect(view).toEqual({
      bounds: [[9.2773, 47.39], [9.2773, 47.39]],
      fitBoundsOptions: { padding: MAP_AREA_PADDING, maxZoom: MAP_FOCUS_ZOOM },
    });
  });

  it("прямоугольник по нескольким точкам отдаётся углами юго-запад → северо-восток", () => {
    const view = startView(null, { minLat: 40, maxLat: 52, minLon: -3, maxLon: 21 });
    expect(view).toEqual({
      bounds: [[-3, 40], [21, 52]],
      fitBoundsOptions: { padding: MAP_AREA_PADDING, maxZoom: MAP_FOCUS_ZOOM },
    });
  });

  it("названная точка важнее прямоугольника: ссылка зовёт в место, а не в область", () => {
    const view = startView({ id: "company/x", lat: 50, lon: 14 }, area);
    expect(view).toEqual({ center: [14, 50], zoom: MAP_FOCUS_ZOOM });
  });

  it("ни точки, ни прямоугольника — всё как было", () => {
    expect(startView(null, null)).toEqual({ center: MAP_FALLBACK_CENTER, zoom: MAP_FALLBACK_ZOOM });
  });
});

describe("shouldAutoLocate с прямоугольником точек", () => {
  it("камера на точках монеты геолокацией не отнимается", () => {
    // Иначе «Открыть на карте» показывало бы не точки приёма, а того, кто нажал.
    expect(shouldAutoLocate("granted", true)).toBe(false);
  });
});
