import { describe, expect, it } from "vitest";

import {
  QUOTA_SERVICES,
  backgroundMonthlyAllowance,
  budgetVerdict,
  dailyBackgroundAllowance,
  daysInMonth,
  daysLeftInMonth,
  projectedMonthSpend,
  runBudget,
  runsLeftToday,
} from "@/lib/quota/budget";

/** Ноябрь 2026 — тридцать суток; все окна считаются по UTC. */
const nov = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h, 0, 0));

describe("реестр служб", () => {
  it("у CoinPaprika наш запас ниже настоящего", () => {
    const cp = QUOTA_SERVICES.coinpaprika;
    expect(cp.upstreamMonthly).toBe(20_000);
    expect(cp.monthlyBudget).toBe(16_000);
    expect(cp.monthlyBudget).toBeLessThan(cp.upstreamMonthly);
  });

  it("у службы без месячного запаса предел суточный и он наш", () => {
    expect(QUOTA_SERVICES.coingecko.upstreamMonthly).toBeNull();
    expect(QUOTA_SERVICES.coingecko.dailyBackgroundCap).toBe(600);
  });
});

describe("календарь", () => {
  it("сутки месяца и остаток считаются по UTC", () => {
    expect(daysInMonth(nov(20))).toBe(30);
    expect(daysLeftInMonth(nov(20))).toBe(11);
    expect(daysLeftInMonth(nov(30))).toBe(1);
  });

  it("прогонов до конца суток считается от часа", () => {
    expect(runsLeftToday(nov(20, 0), 24)).toBe(24);
    expect(runsLeftToday(nov(20, 23), 24)).toBe(1);
    expect(runsLeftToday(nov(20, 12), 1)).toBe(1);
  });
});

describe("доли", () => {
  it("доля фона на месяц — запас минус броня посетителям", () => {
    expect(backgroundMonthlyAllowance(QUOTA_SERVICES.coinpaprika)).toBe(12_000);
  });

  it("суточная доля — остаток, делённый на сутки до конца месяца", () => {
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 0, nov(1))).toBe(400);
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 11_000, nov(20))).toBe(90);
  });

  it("ровная доля не даёт бюджету нагонять расход", () => {
    // Счётчик заведён 20-го и показывает ноль, хотя месяц уже прожит: «остаток
    // ÷ сутки до конца» выдал бы 1090 за день (живой прогон 20 ноября).
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 0, nov(20))).toBe(400);
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 0, nov(30))).toBe(400);
  });

  it("истраченная доля даёт ноль, а не отрицательное число", () => {
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 99_999, nov(20))).toBe(0);
  });
});

describe("runBudget", () => {
  const base = { bgSpentToday: 0, uiSpentMonth: 0, runsPerDay: 24, fixedCostPerRun: 1, perRunCap: 25 };

  it("месяц начался, прогон почасовой", () => {
    const b = runBudget({ ...base, service: QUOTA_SERVICES.coinpaprika, bgSpentMonth: 0, now: nov(1, 0) });
    expect(b.allowed).toBe(true);
    expect(b.calls).toBe(15); // 400 на сутки ÷ 24 прогона = 16, минус вызов списка
  });

  it("падает после тяжёлого дня посетителей", () => {
    const b = runBudget({ ...base, service: QUOTA_SERVICES.coinpaprika, bgSpentMonth: 11_900, bgSpentToday: 80, now: nov(20, 12) });
    expect(b.calls).toBe(0);
  });

  it("жёсткая граница: истрачено всё вместе — фон молчит", () => {
    const b = runBudget({ ...base, service: QUOTA_SERVICES.coinpaprika, bgSpentMonth: 8_000, uiSpentMonth: 8_000, now: nov(10, 0) });
    expect(b.allowed).toBe(false);
    expect(b.calls).toBe(0);
    expect(b.reason).toBe("budget_spent");
  });

  it("потолок прогона не перешагивается даже при пустом месяце", () => {
    const b = runBudget({
      ...base,
      service: { ...QUOTA_SERVICES.coinpaprika, monthlyBudget: 1_000_000 },
      bgSpentMonth: 0,
      now: nov(1, 0),
    });
    expect(b.calls).toBe(25);
  });

  it("служба без месячного запаса меряется суточным пределом", () => {
    const b = runBudget({
      ...base,
      service: QUOTA_SERVICES.coingecko,
      bgSpentMonth: 0,
      bgSpentToday: 600,
      runsPerDay: 144,
      perRunCap: 5,
      now: nov(20, 12),
    });
    expect(b.allowed).toBe(false);
    expect(b.reason).toBe("daily_cap");
  });
});

describe("прогноз и вердикт", () => {
  it("прогноз месяца считается по прошедшим суткам", () => {
    expect(projectedMonthSpend(1_000, nov(10, 12))).toBe(3_000);
    expect(projectedMonthSpend(0, nov(1, 0))).toBe(0);
  });

  it("молчит, пока расход мал", () => {
    expect(budgetVerdict(QUOTA_SERVICES.coinpaprika, 1_000, nov(10, 12)).level).toBe("quiet");
  });

  it("говорит, когда истрачено больше половины", () => {
    const v = budgetVerdict(QUOTA_SERVICES.coinpaprika, 9_000, nov(20, 12));
    expect(v.level).toBe("loud");
    expect(v.spent).toBe(9_000);
    expect(v.remaining).toBe(7_000);
  });

  it("предупреждает о стене с датой", () => {
    const v = budgetVerdict(QUOTA_SERVICES.coinpaprika, 8_000, nov(10, 12));
    expect(v.level).toBe("loud");
    expect(v.projected).toBe(24_000);
    expect(v.exhaustsOn?.toISOString().slice(0, 10)).toBe("2026-11-20");
  });
});
