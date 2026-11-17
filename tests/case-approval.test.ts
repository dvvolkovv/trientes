import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  canApprove,
  isSoleSignOff,
  rejectBlockers,
  type ApprovalInput,
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
