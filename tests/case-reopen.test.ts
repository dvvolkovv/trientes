import { describe, expect, it, vi } from "vitest";
import { reopenPatch } from "@/lib/cases/reopen";
import { ensureCaseCore } from "@/lib/cases/ensure";

type AnyRec = Record<string, unknown>;

describe("reopenPatch", () => {
  const now = new Date("2026-11-18T09:00:00Z");

  it("срок считается от повторной подачи, а не от первой", () => {
    const p = reopenPatch(now, "POINT");
    // POINT — 3 рабочих дня: со среды 18-го через выходные на понедельник 23-е.
    expect(p.dueAt.toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(p.slaSeconds).toBe(5 * 24 * 3600);
    expect(p.reopenedAt).toBe(now);
  });

  it("стирает решение, обе подписи и часы простоя", () => {
    const p = reopenPatch(now, "KYB");
    expect(p.status).toBe("NEW");
    expect(p.decision).toBe(null);
    expect(p.decisionReason).toBe(null);
    expect(p.decidedAt).toBe(null);
    expect(p.reviewedById).toBe(null);
    expect(p.approvedById).toBe(null);
    expect(p.soleSignOff).toBe(false);
    expect(p.clockStoppedAt).toBe(null);
  });

  it("дело уходит из чьих-то рук в общий котёл", () => {
    expect(reopenPatch(now, "COMPANY").assigneeId).toBe(null);
  });

  it("первое обращение не переписывается: openedAt патч не трогает", () => {
    expect("openedAt" in reopenPatch(now, "COMPANY")).toBe(false);
  });
});

function fakeDb(existing: AnyRec | null) {
  const calls = {
    update: [] as AnyRec[],
    checkDelete: [] as AnyRec[],
    docUpdate: [] as AnyRec[],
    events: [] as AnyRec[],
    created: [] as AnyRec[],
  };
  return {
    calls,
    db: {
      complianceCase: {
        findUnique: vi.fn(async () => existing),
        create: vi.fn(async ({ data }: AnyRec) => {
          calls.created.push(data as AnyRec);
          return { id: "new1", ...(data as AnyRec) };
        }),
        update: vi.fn(async (args: AnyRec) => {
          calls.update.push(args);
          return {};
        }),
      },
      caseEvent: {
        create: vi.fn(async ({ data }: AnyRec) => {
          calls.events.push(data as AnyRec);
          return data;
        }),
      },
      caseCheck: {
        deleteMany: vi.fn(async (args: AnyRec) => {
          calls.checkDelete.push(args);
          return { count: 0 };
        }),
      },
      caseDocument: {
        updateMany: vi.fn(async (args: AnyRec) => {
          calls.docUpdate.push(args);
          return { count: 0 };
        }),
      },
    },
  };
}

const INPUT = {
  subjectType: "POINT" as const,
  subjectId: "p1",
  title: "Кофейня",
  applicantUserId: "u1",
  openedAt: new Date("2026-11-18T09:00:00Z"),
};

describe("ensureCaseCore при повторной подаче", () => {
  it("открытое дело не трогает вовсе", async () => {
    const f = fakeDb({ id: "c1", status: "WAITING_APPLICANT" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await ensureCaseCore(f.db as any, INPUT);
    expect(id).toBe("c1");
    expect(f.calls.update).toHaveLength(0);
    expect(f.calls.events).toHaveLength(0);
  });

  it("решённое дело открывает заново и пишет это в журнал", async () => {
    const f = fakeDb({ id: "c2", status: "REJECTED" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await ensureCaseCore(f.db as any, INPUT);
    expect(id).toBe("c2");
    const data = f.calls.update[0].data as AnyRec;
    expect(data.status).toBe("NEW");
    expect(data.decision).toBe(null);
    expect(f.calls.events[0].kind).toBe("REOPENED");
    expect(f.calls.created).toHaveLength(0);
  });

  it("ответы листа проверок стираются: они были про прежнюю версию объекта", async () => {
    const f = fakeDb({ id: "c3", status: "APPROVED" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCaseCore(f.db as any, INPUT);
    expect(f.calls.checkDelete[0].where).toEqual({ caseId: "c3" });
  });

  it("снимается только «переслать заново»: присылка и есть ответ на эту просьбу", async () => {
    const f = fakeDb({ id: "c4", status: "CLOSED" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCaseCore(f.db as any, INPUT);
    expect(f.calls.docUpdate[0].where).toEqual({ caseId: "c4", verdict: "RESUBMIT" });
    expect((f.calls.docUpdate[0].data as AnyRec).verdict).toBe("PENDING");
  });
});
