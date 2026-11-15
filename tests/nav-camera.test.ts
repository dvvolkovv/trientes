import { describe, expect, it } from "vitest";
import { bearingAlong } from "@/lib/route-geometry";
import { NAV_PITCH, cameraFor, followZoom } from "@/lib/nav-camera";

describe("bearingAlong — курс берётся у линии, а не у компаса", () => {
  // Отрезок строго на восток, затем строго на север.
  const coords: [number, number][] = [
    [14.4, 50.0],
    [14.41, 50.0],
    [14.41, 50.01],
  ];

  it("на первом отрезке смотрит на восток", () => {
    expect(bearingAlong(coords, 0, 0, 100)).toBeCloseTo(90, 0);
  });

  it("в конце линии смотрит на север", () => {
    expect(bearingAlong(coords, 1, 0.9, 50)).toBeCloseTo(0, 0);
  });

  it("заглядывает вперёд через поворот, а не упирается в его угол", () => {
    // 100 м до угла на 700-метровом отрезке: взгляд ещё восточный.
    const b = bearingAlong(coords, 0, 0.99, 300);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(90);
  });

  it("у вырожденной линии курса нет", () => {
    expect(bearingAlong([[14.4, 50.0]], 0, 0, 100)).toBeNull();
    expect(bearingAlong([], 0, 0, 100)).toBeNull();
  });
});

describe("followZoom — чем быстрее, тем дальше видно", () => {
  it("стоящему показывает дом, едущему по трассе — километр", () => {
    expect(followZoom(0)).toBeGreaterThan(followZoom(25));
    expect(followZoom(0)).toBeCloseTo(18, 1);
    expect(followZoom(30)).toBeCloseTo(15.2, 1);
  });

  it("между опорными скоростями меняется плавно", () => {
    const a = followZoom(5);
    expect(a).toBeLessThan(followZoom(2));
    expect(a).toBeGreaterThan(followZoom(10));
  });
});

describe("cameraFor", () => {
  const onRoute = {
    position: [14.4, 50.0] as [number, number],
    snapped: [14.401, 50.0] as [number, number],
    routeBearing: 90,
    gpsBearing: 270,
    speedMps: 10,
    offRouteMeters: null,
    viewportHeight: 800,
  };

  it("на маршруте ведёт по линии: центр на дороге, курс вдоль неё", () => {
    const c = cameraFor(onRoute);
    expect(c.center).toEqual([14.401, 50.0]);
    expect(c.bearing).toBe(90);
    expect(c.pitch).toBe(NAV_PITCH);
  });

  it("метка стоит в нижней части экрана: дорога впереди важнее пройденной", () => {
    expect(cameraFor(onRoute).offset[1]).toBeCloseTo(160, 0);
    expect(cameraFor(onRoute).offset[0]).toBe(0);
  });

  it("сошедшему с маршрута показывает сырую точку и компас", () => {
    const c = cameraFor({ ...onRoute, offRouteMeters: 80 });
    expect(c.center).toEqual([14.4, 50.0]);
    expect(c.bearing).toBe(270);
  });

  it("без курса вовсе карту не крутит", () => {
    const c = cameraFor({ ...onRoute, routeBearing: null, gpsBearing: null });
    expect(c.bearing).toBeNull();
  });

  it("приближение следует за скоростью", () => {
    expect(cameraFor({ ...onRoute, speedMps: 0 }).zoom).toBeGreaterThan(
      cameraFor({ ...onRoute, speedMps: 25 }).zoom,
    );
  });
});
