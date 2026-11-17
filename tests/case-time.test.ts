import { describe, expect, it } from "vitest";
import { beatPatch, closePatch, formatHandled, IDLE_MS, isStale, totalSeconds } from "@/lib/cases/time";

const T = (s: string) => new Date(s);

describe("биение таймера", () => {
  it("продлевает сеанс и копит секунды", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:01:00Z") };
    const patch = beatPatch(entry, T("2026-11-17T10:02:00Z"));
    expect(patch.lastBeatAt.toISOString()).toBe("2026-11-17T10:02:00.000Z");
    expect(patch.seconds).toBe(120);
  });

  it("биение после простоя сеанс не продлевает", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:01:00Z") };
    expect(isStale(entry, T("2026-11-17T10:07:00Z"))).toBe(true);
    expect(isStale(entry, T("2026-11-17T10:03:00Z"))).toBe(false);
  });
});

describe("закрытие сеанса", () => {
  it("закрывается последним биением, а не сейчас — простой не считается работой", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:04:00Z") };
    const patch = closePatch(entry);
    expect(patch.endedAt.toISOString()).toBe("2026-11-17T10:04:00.000Z");
    expect(patch.seconds).toBe(240);
  });

  it("сеанс без единого биения стоит ноль", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:00:00Z") };
    expect(closePatch(entry).seconds).toBe(0);
  });
});

describe("сумма", () => {
  it("складывает секунды всех сеансов", () => {
    expect(totalSeconds([{ seconds: 120 }, { seconds: 240 }, { seconds: 0 }])).toBe(360);
  });
});

describe("порог простоя", () => {
  it("пять минут", () => {
    expect(IDLE_MS).toBe(5 * 60 * 1000);
  });
});

describe("подпись времени", () => {
  it("минуты без часов", () => {
    expect(formatHandled(540)).toBe("9 мин");
  });

  it("часы и минуты", () => {
    expect(formatHandled(8040)).toBe("2 ч 14 мин");
  });

  it("ноль — прочерк", () => {
    expect(formatHandled(0)).toBe("—");
  });
});
