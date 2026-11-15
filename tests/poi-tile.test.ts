import { describe, expect, it } from "vitest";
import {
  TILE_CLASS,
  TILE_MIN_SPAN,
  TILE_SHELL,
  settleTile,
  tileOffset,
  tilePadding,
} from "@/lib/poi-tile";

/** Телефон 390 × 844: шапка 60, закладки 44, плитка кредиткой 246. */
const VIEWPORT = { width: 390, height: 844 };
const COLLAPSED = { top: 104, left: 0, width: 390, height: 246 };

describe("TILE_CLASS", () => {
  it("держит пропорцию банковской карты одной строкой на оба места", () => {
    expect(TILE_CLASS).toBe("aspect-[856/540]");
  });

  it("плитка закруглена: у кредитки острых углов не бывает", () => {
    expect(TILE_SHELL).toContain(TILE_CLASS);
    expect(TILE_SHELL).toMatch(/\brounded-/);
    expect(TILE_SHELL).toContain("overflow-hidden");
  });
});

describe("settleTile", () => {
  it("не трогает состояние на дрожании пальца", () => {
    expect(settleTile({ expanded: false, dx: 0, dy: -8, height: 246, velocity: 0 })).toBe(false);
    expect(settleTile({ expanded: true, dx: 0, dy: 8, height: 700, velocity: 0 })).toBe(true);
  });

  it("отдаёт горизонтальный жест листалке страниц", () => {
    expect(settleTile({ expanded: false, dx: -90, dy: 20, height: 246, velocity: 0 })).toBe(false);
  });

  it("сворачивает раскрытую плитку жестом вниз", () => {
    expect(settleTile({ expanded: true, dx: 0, dy: 220, height: 700, velocity: 0 })).toBe(false);
  });

  it("раскрывает свёрнутую плитку жестом вверх", () => {
    expect(settleTile({ expanded: false, dx: 0, dy: -90, height: 246, velocity: 0 })).toBe(true);
  });

  it("не сворачивает коротким жестом, если он медленный", () => {
    expect(settleTile({ expanded: true, dx: 0, dy: 40, height: 700, velocity: 0.05 })).toBe(true);
  });

  it("слушается скорости на отрыве — короткий флик тоже листает", () => {
    expect(settleTile({ expanded: true, dx: 0, dy: 40, height: 700, velocity: 0.8 })).toBe(false);
  });

  it("жест в сторону текущего состояния ничего не меняет", () => {
    expect(settleTile({ expanded: true, dx: 0, dy: -300, height: 700, velocity: 1 })).toBe(true);
    expect(settleTile({ expanded: false, dx: 0, dy: 300, height: 246, velocity: 1 })).toBe(false);
  });
});

describe("tilePadding", () => {
  it("вписывает маршрут ровно в окно плитки", () => {
    const pad = tilePadding({ tile: COLLAPSED, viewport: VIEWPORT, pad: 16 });
    expect(pad).toEqual({ top: 120, right: 16, bottom: 510, left: 16 });
  });

  it("у раскрытой плитки отступы те же, что были у полосы управления", () => {
    const expanded = { top: 104, left: 0, width: 390, height: 500 };
    const pad = tilePadding({ tile: expanded, viewport: VIEWPORT, pad: 16 });
    expect(pad.top).toBe(120);
    expect(pad.bottom).toBe(844 - 604 + 16);
  });

  it("ужимает отступы, когда они не влезают в экран", () => {
    // Плитка ниже экрана: честные отступы оставили бы полосу в ноль пикселей.
    const squeezed = { top: 800, left: 0, width: 390, height: 300 };
    const pad = tilePadding({ tile: squeezed, viewport: VIEWPORT, pad: 16 });
    expect(pad.top + pad.bottom).toBeLessThanOrEqual(VIEWPORT.height - TILE_MIN_SPAN);
    expect(pad.top).toBeGreaterThan(pad.bottom);
  });

  it("отрицательных отступов не бывает", () => {
    const outside = { top: -50, left: -20, width: 500, height: 200 };
    const pad = tilePadding({ tile: outside, viewport: VIEWPORT, pad: 16 });
    expect(Math.min(pad.top, pad.right, pad.bottom, pad.left)).toBeGreaterThanOrEqual(0);
  });
});

describe("tileOffset", () => {
  it("сдвигает центр карты в центр окна плитки", () => {
    expect(tileOffset({ tile: COLLAPSED, viewport: VIEWPORT })).toEqual([0, -195]);
  });

  it("у плитки по центру экрана сдвига нет", () => {
    const centred = { top: 322, left: 0, width: 390, height: 200 };
    expect(tileOffset({ tile: centred, viewport: VIEWPORT })).toEqual([0, 0]);
  });
});
