import { describe, expect, it } from "vitest";
import { addBusinessDays, computeDue, pausePatch, resumePatch, slaState } from "@/lib/cases/sla";

const T = (s: string) => new Date(s);

describe("addBusinessDays", () => {
  it("пропускает выходные", () => {
    // пятница 13 ноября 2026 + 1 рабочий день = понедельник 16-е
    expect(addBusinessDays(T("2026-11-13T10:00:00Z"), 1).toISOString()).toBe("2026-11-16T10:00:00.000Z");
  });

  it("считает пять рабочих дней через выходные", () => {
    expect(addBusinessDays(T("2026-11-13T10:00:00Z"), 5).toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  it("стартуя в субботу, первый рабочий день — понедельник", () => {
    expect(addBusinessDays(T("2026-11-14T10:00:00Z"), 1).toISOString()).toBe("2026-11-16T10:00:00.000Z");
  });
});

describe("computeDue", () => {
  it("у обычной заявки пять рабочих дней", () => {
    const r = computeDue(T("2026-11-13T10:00:00Z"), "COMPANY");
    expect(r.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(r.slaSeconds).toBe(7 * 24 * 3600); // календарных секунд между датами
  });

  it("у KYB срок вдвое длиннее", () => {
    const a = computeDue(T("2026-11-13T10:00:00Z"), "COMPANY").dueAt.getTime();
    const b = computeDue(T("2026-11-13T10:00:00Z"), "KYB").dueAt.getTime();
    expect(b).toBeGreaterThan(a);
  });
});

describe("slaState", () => {
  const base = { dueAt: T("2026-11-20T10:00:00Z"), slaSeconds: 7 * 24 * 3600, clockStoppedAt: null };

  it("в сроке, пока осталось больше четверти", () => {
    const r = slaState({ ...base, now: T("2026-11-15T10:00:00Z") });
    expect(r.state).toBe("ok");
    expect(r.remainingSeconds).toBe(5 * 24 * 3600);
  });

  it("жёлтая, когда осталось меньше четверти срока", () => {
    expect(slaState({ ...base, now: T("2026-11-19T12:00:00Z") }).state).toBe("warn");
  });

  it("красная после срока", () => {
    const r = slaState({ ...base, now: T("2026-11-21T10:00:00Z") });
    expect(r.state).toBe("late");
    expect(r.remainingSeconds).toBe(0);
  });

  it("остановленные часы — своё состояние, а не просрочка", () => {
    const r = slaState({ ...base, clockStoppedAt: T("2026-11-19T10:00:00Z"), now: T("2026-11-30T10:00:00Z") });
    expect(r.state).toBe("paused");
    expect(r.remainingSeconds).toBe(24 * 3600);
  });
});

describe("остановка и запуск часов", () => {
  it("пауза запоминает момент", () => {
    expect(pausePatch(T("2026-11-18T10:00:00Z"))).toEqual({ clockStoppedAt: T("2026-11-18T10:00:00Z") });
  });

  it("запуск сдвигает срок ровно на простой", () => {
    const patch = resumePatch({
      dueAt: T("2026-11-20T10:00:00Z"),
      clockStoppedAt: T("2026-11-18T10:00:00Z"),
      now: T("2026-11-21T10:00:00Z"),
    });
    expect(patch.dueAt.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(patch.clockStoppedAt).toBeNull();
  });

  it("запуск не сдвигает срок, если часы и не стояли", () => {
    const patch = resumePatch({ dueAt: T("2026-11-20T10:00:00Z"), clockStoppedAt: null, now: T("2026-11-21T10:00:00Z") });
    expect(patch.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });
});
