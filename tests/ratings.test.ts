import { describe, it, expect } from "vitest";
import {
  isValidCoinKey,
  isValidStars,
  summarizeRatings,
  filledStars,
} from "@/lib/ratings";

describe("isValidStars", () => {
  it("принимает целое от одной до пяти", () => {
    for (const s of [1, 2, 3, 4, 5]) expect(isValidStars(s)).toBe(true);
  });

  it("отвергает всё, что оценкой не является", () => {
    for (const s of [0, 6, -1, 2.5, NaN, Infinity, "3", null, undefined, {}]) {
      expect(isValidStars(s)).toBe(false);
    }
  });
});

describe("isValidCoinKey", () => {
  it("принимает адрес страницы монеты", () => {
    expect(isValidCoinKey("bitcoin")).toBe(true);
    expect(isValidCoinKey("usd-coin")).toBe(true);
    expect(isValidCoinKey("taler")).toBe(true);
  });

  it("отвергает ключ, которым можно насыпать в таблицу что угодно", () => {
    expect(isValidCoinKey("")).toBe(false);
    expect(isValidCoinKey("-btc")).toBe(false);
    expect(isValidCoinKey("../etc/passwd")).toBe(false);
    expect(isValidCoinKey("a".repeat(65))).toBe(false);
  });
});

describe("summarizeRatings", () => {
  it("считает среднее до десятой доли", () => {
    expect(summarizeRatings([5, 4, 4])).toEqual({ average: 4.3, count: 3, mine: null });
  });

  it("без голосов средней нет — ноль звёзд это тоже утверждение", () => {
    expect(summarizeRatings([])).toEqual({ average: null, count: 0, mine: null });
  });

  it("негодные значения в среднее не идут", () => {
    expect(summarizeRatings([5, 0, 99, 3])).toEqual({ average: 4, count: 2, mine: null });
  });

  it("свою оценку отдаёт отдельно от средней", () => {
    expect(summarizeRatings([5, 1], 1)).toEqual({ average: 3, count: 2, mine: 1 });
  });
});

describe("filledStars", () => {
  it("закрашивает ближайшее целое", () => {
    expect(filledStars(4.3)).toBe(4);
    expect(filledStars(4.5)).toBe(5);
    expect(filledStars(1)).toBe(1);
  });

  it("без средней не закрашивает ничего", () => {
    expect(filledStars(null)).toBe(0);
  });

  it("за пределы шкалы не выходит", () => {
    expect(filledStars(9)).toBe(5);
    expect(filledStars(-3)).toBe(0);
  });
});
