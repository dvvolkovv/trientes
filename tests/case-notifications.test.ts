import { describe, expect, it } from "vitest";
import {
  DUE_SOON_SECONDS,
  SILENT_WAIT_SECONDS,
  dueNotificationFor,
} from "@/lib/cases/notifications";

const T = (s: string) => new Date(s);
const now = T("2026-11-17T12:00:00Z");

const base = {
  status: "IN_REVIEW" as const,
  assigneeId: "u1" as string | null,
  dueAt: T("2026-11-25T12:00:00Z"),
  clockStoppedAt: null as Date | null,
  lastStaffMessageAt: null as Date | null,
};

describe("dueNotificationFor", () => {
  it("далёкий срок никого не трогает", () => {
    expect(dueNotificationFor(base, now)).toBeNull();
  });

  it("за сутки до срока — звонок", () => {
    expect(dueNotificationFor({ ...base, dueAt: T("2026-11-18T06:00:00Z") }, now)).toBe("DUE_SOON");
  });

  it("просрочка важнее приближения", () => {
    expect(dueNotificationFor({ ...base, dueAt: T("2026-11-16T12:00:00Z") }, now)).toBe("CASE_OVERDUE");
  });

  it("дело без взявшего личных звонков не рассылает", () => {
    expect(dueNotificationFor({ ...base, assigneeId: null, dueAt: T("2026-11-16T12:00:00Z") }, now)).toBeNull();
  });

  it("решённое дело не звонит", () => {
    expect(dueNotificationFor({ ...base, status: "APPROVED", dueAt: T("2026-11-16T12:00:00Z") }, now)).toBeNull();
  });

  it("пока часы стоят, про срок не звоним — он не течёт", () => {
    expect(
      dueNotificationFor(
        { ...base, status: "WAITING_APPLICANT", clockStoppedAt: T("2026-11-17T11:00:00Z"), dueAt: T("2026-11-18T06:00:00Z") },
        now,
      ),
    ).toBeNull();
  });

  it("но про долгое молчание заявителя звоним — иначе дело висит вечно", () => {
    expect(
      dueNotificationFor(
        {
          ...base,
          status: "WAITING_APPLICANT",
          clockStoppedAt: T("2026-11-01T12:00:00Z"),
          lastStaffMessageAt: T("2026-11-01T12:00:00Z"),
          dueAt: T("2026-11-25T12:00:00Z"),
        },
        now,
      ),
    ).toBe("APPLICANT_SILENT");
  });

  it("две недели ещё не прошли — молчим", () => {
    expect(
      dueNotificationFor(
        {
          ...base,
          status: "WAITING_APPLICANT",
          clockStoppedAt: T("2026-11-10T12:00:00Z"),
          lastStaffMessageAt: T("2026-11-10T12:00:00Z"),
          dueAt: T("2026-11-25T12:00:00Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});

describe("пороги", () => {
  it("сутки и четырнадцать дней", () => {
    expect(DUE_SOON_SECONDS).toBe(86400);
    expect(SILENT_WAIT_SECONDS).toBe(14 * 86400);
  });
});
