import { describe, expect, it } from "vitest";
import {
  cashbackSummary,
  effectiveCashback,
  parseRate,
} from "@/lib/loyalty/rates";
import { LOYALTY_LEVELS, levelFor } from "@/lib/loyalty/levels";

describe("parseRate", () => {
  it("takes a rate the way the offer form takes one — dot or comma", () => {
    expect(parseRate("5")).toEqual({ ok: true, value: 5 });
    expect(parseRate("3,25")).toEqual({ ok: true, value: 3.25 });
    expect(parseRate(" 0.1 ")).toEqual({ ok: true, value: 0.1 });
  });

  it("treats an empty string as «no rate», not as zero percent", () => {
    expect(parseRate("")).toEqual({ ok: true, value: null });
    expect(parseRate("   ")).toEqual({ ok: true, value: null });
  });

  it("refuses what is not a rate and what is outside the offer limits", () => {
    expect(parseRate("0")).toEqual({ ok: false, reason: "cashback_invalid" });
    expect(parseRate("0.05")).toEqual({ ok: false, reason: "cashback_invalid" });
    expect(parseRate("500")).toEqual({ ok: false, reason: "cashback_invalid" });
    expect(parseRate("abc")).toEqual({ ok: false, reason: "cashback_invalid" });
  });
});

describe("effectiveCashback", () => {
  it("lets the nearest rate win, not the biggest one", () => {
    // Распродажа наоборот: ставка товара ниже общей и обязана её перебить.
    expect(effectiveCashback({ offer: 1, category: 4, company: 7 })).toEqual({
      percent: 1,
      source: "offer",
    });
    expect(effectiveCashback({ offer: null, category: 2, company: 7 })).toEqual({
      percent: 2,
      source: "category",
    });
    expect(effectiveCashback({ offer: null, category: null, company: 7 })).toEqual({
      percent: 7,
      source: "company",
    });
  });

  it("covers all eight combinations of present and absent", () => {
    const cases: Array<[number | null, number | null, number | null, number | null, string | null]> = [
      [1, 2, 3, 1, "offer"],
      [1, 2, null, 1, "offer"],
      [1, null, 3, 1, "offer"],
      [1, null, null, 1, "offer"],
      [null, 2, 3, 2, "category"],
      [null, 2, null, 2, "category"],
      [null, null, 3, 3, "company"],
      [null, null, null, null, null],
    ];
    for (const [offer, category, company, percent, source] of cases) {
      const got = effectiveCashback({ offer, category, company });
      if (percent === null) expect(got).toBeNull();
      else expect(got).toEqual({ percent, source });
    }
  });
});

describe("cashbackSummary", () => {
  it("names the base rate and the best category rate", () => {
    expect(cashbackSummary({ base: 3, categories: [4, 7, 2] })).toEqual({ base: 3, max: 7 });
  });

  it("is null when nothing is promised at all", () => {
    expect(cashbackSummary({ base: null, categories: [] })).toBeNull();
  });

  it("does not invent a maximum when it equals the base — there is nothing «up to»", () => {
    expect(cashbackSummary({ base: 5, categories: [3, 5] })).toEqual({ base: 5, max: null });
  });

  it("works with categories only", () => {
    expect(cashbackSummary({ base: null, categories: [2] })).toEqual({ base: null, max: 2 });
  });
});

describe("loyalty levels", () => {
  it("is a ladder: thresholds and platform bonuses only grow", () => {
    for (let i = 1; i < LOYALTY_LEVELS.length; i += 1) {
      expect(LOYALTY_LEVELS[i].minTurnoverUsd).toBeGreaterThan(LOYALTY_LEVELS[i - 1].minTurnoverUsd);
      expect(LOYALTY_LEVELS[i].platformBonusPercent).toBeGreaterThan(
        LOYALTY_LEVELS[i - 1].platformBonusPercent,
      );
    }
    expect(LOYALTY_LEVELS[0].minTurnoverUsd).toBe(0);
    expect(LOYALTY_LEVELS[0].platformBonusPercent).toBe(0);
  });

  it("tells «not measured» apart from «zero»", () => {
    const unknown = levelFor(null);
    expect(unknown.measured).toBe(false);
    expect(unknown.level.key).toBe(LOYALTY_LEVELS[0].key);

    const zero = levelFor(0);
    expect(zero.measured).toBe(true);
    expect(zero.level.key).toBe(LOYALTY_LEVELS[0].key);
  });

  it("picks the highest reached step and names the next one", () => {
    const gold = LOYALTY_LEVELS[2];
    const onTheDot = levelFor(gold.minTurnoverUsd);
    expect(onTheDot.level.key).toBe(gold.key);
    expect(onTheDot.next?.key).toBe(LOYALTY_LEVELS[3].key);

    const justBelow = levelFor(gold.minTurnoverUsd - 0.01);
    expect(justBelow.level.key).toBe(LOYALTY_LEVELS[1].key);

    const top = levelFor(LOYALTY_LEVELS[LOYALTY_LEVELS.length - 1].minTurnoverUsd * 10);
    expect(top.level.key).toBe(LOYALTY_LEVELS[LOYALTY_LEVELS.length - 1].key);
    expect(top.next).toBeNull();
  });

  it("refuses a negative turnover as unmeasured rather than guessing", () => {
    expect(levelFor(-5).measured).toBe(false);
  });
});
