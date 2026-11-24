import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { encodeQr } from "@/lib/qr";
import { QUIET_ZONE, qrDrawing, qrPath } from "@/lib/qr-draw";

const RUN = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;

/** Тёмные модули, вычитанные обратно из пути; путь с чем-либо ещё внутри валит тест. */
function modulesOf(d: string, size: number): boolean[][] {
  expect(d.replace(RUN, "")).toBe("");
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const m of d.matchAll(RUN)) {
    const [x, y, w, back] = [1, 2, 3, 4].map((i) => Number(m[i]));
    expect(back).toBe(w);
    for (let i = 0; i < w!; i++) grid[y! - QUIET_ZONE]![x! - QUIET_ZONE + i] = true;
  }
  return grid;
}

/** Что увидит камера: путь как картинка, 4 пикселя на модуль, со светлым полем. */
function readDrawing(text: string): string | null {
  const drawing = qrDrawing(text)!;
  const grid = modulesOf(drawing.d, drawing.side - 2 * QUIET_ZONE);
  const scale = 4;
  const px = drawing.side * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  grid.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + QUIET_ZONE) * scale + dy) * px + (x + QUIET_ZONE) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  return jsQR(data, px, px)?.data ?? null;
}

describe("символ приглашения как путь SVG", () => {
  const link = "https://trientes.org/ru/invite/Kl_oASzf0HuU79JAxMUYwDpSHQGq09bS";

  it("путь закрашивает ровно тёмные модули, внутри светлого поля", () => {
    const q = encodeQr(link);
    expect(modulesOf(qrPath(q.modules), q.size)).toEqual(q.modules);
  });

  it("подряд идущие модули строки — один прямоугольник", () => {
    expect(qrPath([[true, true, true, false, true]])).toBe("M4 4h3v1h-3zM8 4h1v1h-1z");
    expect(qrPath([[false, false]])).toBe("");
  });

  it("камера читает с нарисованного символа ровно ту ссылку", () => {
    for (const text of [
      link,
      "https://trientes.org/en/staff-invite/0f3c9a2b7d614e8fa05c1b9e6d2f4a73",
      "https://trientes.org/sk/invite/coin/Kl_oASzf0HuU79JAxMUYwDpSHQGq09bS",
    ]) {
      expect(readDrawing(text)).toBe(text);
    }
  });

  it("текст, который символ не вмещает, не рисуется вовсе и ничего не роняет", () => {
    expect(qrDrawing("x".repeat(214))).toBeNull();
    expect(qrDrawing("\ud800")).toBeNull(); // одинокий суррогат — кодировать нечего
  });

  it("ссылка приглашения помещается с большим запасом", () => {
    const q = encodeQr(link);
    expect(q.version).toBeLessThanOrEqual(5);
  });
});
