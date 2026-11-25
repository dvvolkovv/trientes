import { describe, expect, it } from "vitest";
import { MAX_PERIOD_DAYS, resolvePeriod, zonedDayKey, zonedStartOfDay } from "@/lib/reports/period";

/**
 * Слайс CL: сутки отчёта считаются в поясе предприятия, а не в поясе процесса. Сервер
 * стоит в UTC, и «выручка за 25 ноября» без пояса — не число, а догадка (разбор BN).
 */
describe("период отчёта", () => {
  it("начало суток берётся в названном поясе", () => {
    // Прага зимой — UTC+1, значит местная полночь это 23:00 предыдущего дня по UTC.
    expect(zonedStartOfDay("2026-11-25", "Europe/Prague").toISOString()).toBe("2026-11-24T23:00:00.000Z");
    expect(zonedStartOfDay("2026-11-25", "UTC").toISOString()).toBe("2026-11-25T00:00:00.000Z");
  });

  it("переход на летнее время не сдвигает сутки на час", () => {
    // 29 марта 2026 Европа переводит часы: до полуночи ещё UTC+1, после — UTC+2.
    expect(zonedStartOfDay("2026-03-29", "Europe/Prague").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(zonedStartOfDay("2026-03-30", "Europe/Prague").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("день мгновения считается в поясе, а не в UTC", () => {
    const lateEvening = new Date("2026-11-24T23:30:00.000Z");
    expect(zonedDayKey(lateEvening, "UTC")).toBe("2026-11-24");
    expect(zonedDayKey(lateEvening, "Europe/Prague")).toBe("2026-11-25");
  });

  it("«сегодня» — одни сутки, конец периода исключающий", () => {
    const p = resolvePeriod({ range: "today", tz: "UTC", now: new Date("2026-11-25T10:00:00Z") });
    expect([p.fromDay, p.toDay]).toEqual(["2026-11-25", "2026-11-25"]);
    expect(p.from.toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });

  it("неделя и месяц включают сегодняшний день", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(resolvePeriod({ range: "week", tz: "UTC", now }).fromDay).toBe("2026-11-19");
    expect(resolvePeriod({ range: "month", tz: "UTC", now }).fromDay).toBe("2026-10-27");
  });

  it("свой период переворачивается, если даты набраны наоборот", () => {
    const p = resolvePeriod({
      range: "custom",
      from: "2026-11-25",
      to: "2026-11-01",
      tz: "UTC",
      now: new Date("2026-11-25T10:00:00Z"),
    });
    expect([p.fromDay, p.toDay]).toEqual(["2026-11-01", "2026-11-25"]);
  });

  it("негодные даты читаются как сегодня, а не как «вся база»", () => {
    const p = resolvePeriod({ range: "custom", from: "вчера", to: "", tz: "UTC", now: new Date("2026-11-25T10:00:00Z") });
    expect(p.range).toBe("today");
    expect([p.fromDay, p.toDay]).toEqual(["2026-11-25", "2026-11-25"]);
  });

  it("период длиннее года отрезается от начала", () => {
    const p = resolvePeriod({
      range: "custom",
      from: "2020-01-01",
      to: "2026-11-25",
      tz: "UTC",
      now: new Date("2026-11-25T10:00:00Z"),
    });
    const days = (p.to.getTime() - p.from.getTime()) / (24 * 3600 * 1000);
    expect(days).toBe(MAX_PERIOD_DAYS);
    expect(p.toDay).toBe("2026-11-25");
  });
});
