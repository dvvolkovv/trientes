import { describe, expect, it } from "vitest";
import { OFF_ROUTE_M, OffRouteWatch, REROUTE_COOLDOWN_MS } from "@/lib/nav-offroute";

describe("OffRouteWatch — один плохой отсчёт маршрут не ломает", () => {
  it("порог у машины шире: соседняя полоса не сход с маршрута", () => {
    expect(OFF_ROUTE_M.car).toBeGreaterThan(OFF_ROUTE_M.walk);
  });

  it("молчит, пока человек на линии", () => {
    const w = new OffRouteWatch("car");
    expect(w.feed(10, 1000)).toBe(false);
    expect(w.feed(12, 2000)).toBe(false);
  });

  it("требует трёх отсчётов подряд", () => {
    const w = new OffRouteWatch("walk");
    expect(w.feed(60, 1000)).toBe(false);
    expect(w.feed(70, 2000)).toBe(false);
    expect(w.feed(80, 3000)).toBe(true);
  });

  it("возврат на линию обнуляет счёт", () => {
    const w = new OffRouteWatch("walk");
    w.feed(60, 1000);
    w.feed(70, 2000);
    w.feed(5, 3000);
    expect(w.feed(80, 4000)).toBe(false);
  });

  it("второй раз подряд не перестраивает — выдержка", () => {
    const w = new OffRouteWatch("walk");
    w.feed(60, 1000);
    w.feed(60, 2000);
    expect(w.feed(60, 3000)).toBe(true);
    w.feed(60, 4000);
    w.feed(60, 5000);
    expect(w.feed(60, 6000)).toBe(false);
  });

  it("после выдержки перестраивает снова: маршрут мог не помочь", () => {
    const w = new OffRouteWatch("walk");
    w.feed(60, 1000);
    w.feed(60, 2000);
    w.feed(60, 3000);
    const after = 3000 + REROUTE_COOLDOWN_MS + 1;
    w.feed(60, after);
    w.feed(60, after + 1000);
    expect(w.feed(60, after + 2000)).toBe(true);
  });

  it("новый маршрут начинает счёт с чистого листа", () => {
    const w = new OffRouteWatch("walk");
    w.feed(60, 1000);
    w.feed(60, 2000);
    w.routeChanged(2500);
    expect(w.feed(60, 3000)).toBe(false);
  });

  it("неизмеримое расстояние считается сходом: без линии вести некуда", () => {
    const w = new OffRouteWatch("car");
    expect(w.offRoute(Number.POSITIVE_INFINITY)).toBe(true);
    expect(w.offRoute(5)).toBe(false);
  });
});
