import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  canApprove,
  isSoleSignOff,
  rejectBlockers,
  type ApprovalInput,
  countApprovers,
  type ApproverRow,
} from "@/lib/cases/approval";

const base: ApprovalInput = {
  requiredPending: 0,
  resubmitDocs: 0,
  reviewedById: "alice",
  meId: "bob",
  otherApproversCount: 1,
};

describe("approvalBlockers", () => {
  it("два живых человека и закрытый лист — одобрение проходит", () => {
    expect(approvalBlockers(base)).toEqual([]);
    expect(canApprove(base)).toBe(true);
  });

  it("незакрытый обязательный пункт блокирует", () => {
    expect(approvalBlockers({ ...base, requiredPending: 2 })).toContain("checks_pending");
  });

  it("документ, который ждём заново, блокирует", () => {
    expect(approvalBlockers({ ...base, resubmitDocs: 1 })).toContain("documents_resubmit");
  });

  it("без первой подписи одобрять нечего", () => {
    expect(approvalBlockers({ ...base, reviewedById: null })).toEqual(["not_reviewed"]);
  });

  it("проверивший не утверждает сам себя, пока есть второй сотрудник", () => {
    expect(approvalBlockers({ ...base, meId: "alice" })).toEqual(["same_person"]);
  });

  it("единственный сотрудник решение проводит", () => {
    const sole = { ...base, meId: "alice", otherApproversCount: 0 };
    expect(approvalBlockers(sole)).toEqual([]);
    expect(isSoleSignOff(sole)).toBe(true);
  });

  it("второй человек — это не подпись одним лицом", () => {
    expect(isSoleSignOff(base)).toBe(false);
    expect(isSoleSignOff({ ...base, otherApproversCount: 0 })).toBe(false);
  });

  it("препятствия складываются, а не прячут друг друга", () => {
    const b = approvalBlockers({ ...base, requiredPending: 1, resubmitDocs: 1, reviewedById: null });
    expect(b).toEqual(["checks_pending", "documents_resubmit", "not_reviewed"]);
  });
});

describe("rejectBlockers", () => {
  it("отказ требует причины", () => {
    expect(rejectBlockers("  ")).toEqual(["reason_too_short"]);
    expect(rejectBlockers("no")).toEqual(["reason_too_short"]);
  });

  it("второй подписи отказ не требует", () => {
    expect(rejectBlockers("скан не читается")).toEqual([]);
  });
});

describe("countApprovers — вторая подпись по очереди", () => {
  const NOW = new Date("2026-11-18T10:00:00Z");

  function row(p: Partial<ApproverRow> & { userId: string }): ApproverRow {
    return { level: "APPROVE", expiresAt: null, revokedAt: null, role: "STAFF", ...p };
  }

  it("право «ведёт» второй подписью не считается", () => {
    expect(countApprovers([row({ userId: "u2", level: "HANDLE" })], "u1", NOW)).toBe(0);
  });

  it("право «утверждает» считается, проверивший — нет", () => {
    const rows = [row({ userId: "u1" }), row({ userId: "u2" })];
    expect(countApprovers(rows, "u1", NOW)).toBe(1);
  });

  it("отозванный и истёкший не считаются", () => {
    const rows = [
      row({ userId: "u2", revokedAt: NOW }),
      row({ userId: "u3", expiresAt: new Date("2026-11-17T00:00:00Z") }),
    ];
    expect(countApprovers(rows, "u1", NOW)).toBe(0);
  });

  it("владелец считается второй подписью и без грантов", () => {
    expect(countApprovers([row({ userId: "u9", level: null, role: "OWNER" })], "u1", NOW)).toBe(1);
  });

  it("наследие ADMIN тоже владелец", () => {
    expect(countApprovers([row({ userId: "u9", level: null, role: "ADMIN" })], "u1", NOW)).toBe(1);
  });

  it("один человек двумя строками прав — один утверждающий", () => {
    const rows = [row({ userId: "u2" }), row({ userId: "u2" })];
    expect(countApprovers(rows, "u1", NOW)).toBe(1);
  });

  it("посетитель с грантом не утверждающий", () => {
    expect(countApprovers([row({ userId: "u2", role: "USER" })], "u1", NOW)).toBe(0);
  });
});
