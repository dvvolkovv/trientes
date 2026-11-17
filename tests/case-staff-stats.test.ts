import { describe, expect, it } from "vitest";
import { buildStaffStats, ownerOf, type StaffCaseRow } from "@/lib/cases/staff-stats";

const T = (s: string) => new Date(s);

function row(over: Partial<StaffCaseRow> = {}): StaffCaseRow {
  return {
    reviewedById: "alice",
    assigneeId: "alice",
    approvedById: "bob",
    decision: "APPROVED",
    soleSignOff: false,
    handledSeconds: 600,
    openedAt: T("2026-11-01T10:00:00Z"),
    firstResponseAt: T("2026-11-01T12:00:00Z"),
    decidedAt: T("2026-11-03T10:00:00Z"),
    dueAt: T("2026-11-06T10:00:00Z"),
    ...over,
  };
}

describe("ownerOf", () => {
  it("дело считается на проверившего", () => {
    expect(ownerOf(row({ reviewedById: "alice", assigneeId: "carol" }))).toBe("alice");
  });

  it("без подписи — на взявшего в работу", () => {
    expect(ownerOf(row({ reviewedById: null, assigneeId: "carol" }))).toBe("carol");
  });

  it("ничей — ничей", () => {
    expect(ownerOf(row({ reviewedById: null, assigneeId: null }))).toBeNull();
  });
});

describe("buildStaffStats", () => {
  it("вторая подпись не считается закрытым делом", () => {
    const { stats } = buildStaffStats([row()]);
    const alice = stats.find((s) => s.userId === "alice")!;
    const bob = stats.find((s) => s.userId === "bob")!;
    expect(alice.decided).toBe(1);
    expect(alice.secondSignatures).toBe(0);
    expect(bob.decided).toBe(0);
    expect(bob.secondSignatures).toBe(1);
  });

  it("подпись одним лицом второй подписью не считается", () => {
    const { stats } = buildStaffStats([row({ approvedById: "alice", soleSignOff: true })]);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.userId).toBe("alice");
    expect(stats[0]?.secondSignatures).toBe(0);
    expect(stats[0]?.soleSignOffs).toBe(1);
  });

  it("считает долю отказов и среднее время в руках", () => {
    const { stats } = buildStaffStats([
      row({ decision: "APPROVED", handledSeconds: 600 }),
      row({ decision: "REJECTED", handledSeconds: 1200 }),
    ]);
    const alice = stats.find((s) => s.userId === "alice")!;
    expect(alice.decided).toBe(2);
    expect(alice.rejected).toBe(1);
    expect(alice.rejectShare).toBe(0.5);
    expect(alice.avgHandledSeconds).toBe(900);
  });

  it("среднее время до первого ответа считается только по тем делам, где он был", () => {
    const { stats } = buildStaffStats([
      row({ firstResponseAt: T("2026-11-01T11:00:00Z") }), // час
      row({ firstResponseAt: null }),
    ]);
    expect(stats.find((s) => s.userId === "alice")!.avgFirstResponseSeconds).toBe(3600);
  });

  it("ни одного ответа — пусто, а не ноль", () => {
    const { stats } = buildStaffStats([row({ firstResponseAt: null })]);
    expect(stats.find((s) => s.userId === "alice")!.avgFirstResponseSeconds).toBeNull();
  });

  it("просрочка — решение позже срока", () => {
    const { stats } = buildStaffStats([
      row({ decidedAt: T("2026-11-07T10:00:00Z") }),
      row({ decidedAt: T("2026-11-05T10:00:00Z") }),
    ]);
    expect(stats.find((s) => s.userId === "alice")!.overdue).toBe(1);
  });

  it("дело без ведущего попадает в отдельное число", () => {
    const { stats, unattributed } = buildStaffStats([
      row({ reviewedById: null, assigneeId: null, approvedById: null }),
    ]);
    expect(unattributed).toBe(1);
    expect(stats).toHaveLength(0);
  });

  it("сотрудник, который только просил документы заново, в таблице виден", () => {
    const { stats } = buildStaffStats([], new Map([["carol", 3]]));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ userId: "carol", decided: 0, resubmits: 3 });
  });
});
