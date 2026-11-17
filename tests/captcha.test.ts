import { describe, expect, it } from "vitest";
import {
  CAPTCHA_STAGE,
  CAPTCHA_TOLERANCE,
  MAX_AGE_MS,
  MIN_SOLVE_MS,
  checkTiming,
  isSolved,
  newGeometry,
} from "@/lib/captcha";

describe("captcha geometry", () => {
  it("точка сборки каждый раз новая и внутри поля", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const g = newGeometry();
      seen.add(`${Math.round(g.home.x)}:${Math.round(g.home.y)}`);
      expect(g.home.x).toBeGreaterThanOrEqual(0);
      expect(g.home.y).toBeGreaterThanOrEqual(0);
      expect(g.home.x + g.mark.w).toBeLessThanOrEqual(CAPTCHA_STAGE.w);
      expect(g.home.y + g.mark.h).toBeLessThanOrEqual(CAPTCHA_STAGE.h);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("вынутая часть начинается далеко от места и внутри поля", () => {
    for (let i = 0; i < 100; i++) {
      const g = newGeometry();
      const d = Math.hypot(g.start.x - g.home.x, g.start.y - g.home.y);
      expect(d).toBeGreaterThan(CAPTCHA_TOLERANCE * 3);
      expect(g.start.x).toBeGreaterThanOrEqual(0);
      expect(g.start.y).toBeGreaterThanOrEqual(0);
      expect(g.start.x + g.mark.w).toBeLessThanOrEqual(CAPTCHA_STAGE.w);
      expect(g.start.y + g.mark.h).toBeLessThanOrEqual(CAPTCHA_STAGE.h);
    }
  });

  it("решение принимается в пределах допуска", () => {
    const home = { x: 100, y: 50 };
    expect(isSolved(home, { x: 100, y: 50 })).toBe(true);
    expect(isSolved(home, { x: 100 + CAPTCHA_TOLERANCE - 1, y: 50 })).toBe(true);
    expect(isSolved(home, { x: 100 + CAPTCHA_TOLERANCE + 2, y: 50 })).toBe(false);
    expect(isSolved(home, { x: 100, y: 50 + CAPTCHA_TOLERANCE + 2 })).toBe(false);
  });

  it("мгновенный ответ не принимается, просроченный тоже", () => {
    const issued = 1_000_000;
    expect(checkTiming(issued, issued + MIN_SOLVE_MS - 1)).toBe("captcha_too_fast");
    expect(checkTiming(issued, issued + MIN_SOLVE_MS + 1)).toBe(null);
    expect(checkTiming(issued, issued + MAX_AGE_MS + 1)).toBe("captcha_expired");
    // Часы клиента и сервера не совпадают: будущее тоже просрочка, а не минус.
    expect(checkTiming(issued, issued - 5_000)).toBe("captcha_expired");
  });
});
