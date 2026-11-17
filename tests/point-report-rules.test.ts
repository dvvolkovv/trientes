import { describe, expect, it } from "vitest";
import {
  ESCALATE_AT,
  escalationFor,
  independentReporters,
  reporterIpHash,
  tooSoon,
} from "@/lib/points/report-rules";

const T0 = new Date("2026-11-18T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3600_000);
const days = (n: number) => new Date(T0.getTime() + n * 86400_000);

describe("reporterIpHash", () => {
  it("один адрес даёт один хэш и адрес в нём не читается", () => {
    expect(reporterIpHash("1.2.3.4")).toBe(reporterIpHash("1.2.3.4"));
    expect(reporterIpHash("1.2.3.4")).not.toContain("1.2.3.4");
    expect(reporterIpHash("1.2.3.4")).not.toBe(reporterIpHash("1.2.3.5"));
  });
});

describe("tooSoon", () => {
  it("вторая жалоба с того же адреса в те же сутки отвергается", () => {
    expect(tooSoon(T0, hours(5))).toBe(true);
  });
  it("через сутки можно снова", () => {
    expect(tooSoon(T0, hours(25))).toBe(false);
  });
  it("первой жалобе ничто не мешает", () => {
    expect(tooSoon(null, T0)).toBe(false);
  });
});

describe("independentReporters", () => {
  const row = (
    over: Partial<{ reporterUserId: string | null; reporterIpHash: string; createdAt: Date }>,
  ) => ({
    reporterUserId: null,
    reporterIpHash: "h1",
    createdAt: T0,
    ...over,
  });

  it("три разных адреса считаются тремя", () => {
    const n = independentReporters(
      [row({ reporterIpHash: "a" }), row({ reporterIpHash: "b" }), row({ reporterIpHash: "c" })],
      T0,
    );
    expect(n).toBe(3);
  });

  it("один адрес трижды — это одна жалоба", () => {
    const n = independentReporters(
      [row({ createdAt: days(-10) }), row({ createdAt: days(-5) }), row({})],
      T0,
    );
    expect(n).toBe(1);
  });

  it("вошедший считается по учётной записи, а не по адресу", () => {
    const n = independentReporters(
      [
        row({ reporterUserId: "u1", reporterIpHash: "a" }),
        row({ reporterUserId: "u1", reporterIpHash: "b" }),
      ],
      T0,
    );
    expect(n).toBe(1);
  });

  it("жалоба старше окна не считается", () => {
    const n = independentReporters(
      [row({ reporterIpHash: "a", createdAt: days(-61) }), row({ reporterIpHash: "b" })],
      T0,
    );
    expect(n).toBe(1);
  });
});

describe("escalationFor", () => {
  const base = {
    independent: ESCALATE_AT,
    underReviewAt: null,
    askedAt: null,
    warnedAt: null,
    suspendedAt: null,
    ownerRepliedAt: null,
    now: T0,
  };

  it("меньше порога — ничего не делаем", () => {
    expect(escalationFor({ ...base, independent: ESCALATE_AT - 1 })).toBeNull();
  });

  it("порог достигнут — пометка и вопрос предприятию", () => {
    expect(escalationFor(base)).toBe("REVIEW");
  });

  it("вопрос задан, две недели не прошли — ждём", () => {
    expect(escalationFor({ ...base, underReviewAt: T0, askedAt: T0, now: days(13) })).toBeNull();
  });

  it("две недели молчания — предупреждение", () => {
    expect(escalationFor({ ...base, underReviewAt: T0, askedAt: T0, now: days(14) })).toBe("WARN");
  });

  it("ответ предприятия останавливает эскалацию", () => {
    expect(
      escalationFor({
        ...base,
        underReviewAt: T0,
        askedAt: T0,
        ownerRepliedAt: days(1),
        now: days(30),
      }),
    ).toBeNull();
  });

  it("ещё две недели после предупреждения — снятие с карты", () => {
    expect(
      escalationFor({ ...base, underReviewAt: T0, askedAt: T0, warnedAt: days(14), now: days(28) }),
    ).toBe("SUSPEND");
  });

  it("снятая точка больше не эскалируется", () => {
    expect(
      escalationFor({
        ...base,
        underReviewAt: T0,
        askedAt: T0,
        warnedAt: days(14),
        suspendedAt: days(28),
        now: days(90),
      }),
    ).toBeNull();
  });
});
