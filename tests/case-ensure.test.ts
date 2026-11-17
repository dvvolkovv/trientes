import { describe, expect, it, vi } from "vitest";
import { ensureCaseCore } from "@/lib/cases/ensure";

type AnyRec = Record<string, unknown>;

function makeFakePrisma() {
  const cases: Record<string, AnyRec> = {};
  const events: AnyRec[] = [];
  let seq = 0;
  return {
    state: { cases, events },
    prisma: {
      complianceCase: {
        findUnique: vi.fn(async ({ where }: AnyRec) => {
          const k = (where as AnyRec).subjectType_subjectId as AnyRec;
          return cases[`${k.subjectType}:${k.subjectId}`] ?? null;
        }),
        create: vi.fn(async ({ data }: AnyRec) => {
          const d = data as AnyRec;
          const key = `${d.subjectType}:${d.subjectId}`;
          if (cases[key]) {
            const err = new Error("unique") as Error & { code?: string };
            err.code = "P2002";
            throw err;
          }
          cases[key] = { id: `case${++seq}`, ...d };
          return cases[key];
        }),
      },
      caseEvent: {
        create: vi.fn(async ({ data }: AnyRec) => {
          events.push(data as AnyRec);
          return data;
        }),
      },
    },
  };
}

const INPUT = {
  subjectType: "COMPANY" as const,
  subjectId: "co1",
  title: "ACME d.o.o.",
  applicantUserId: "u1",
  openedAt: new Date("2026-11-13T10:00:00Z"),
};

describe("ensureCaseCore", () => {
  it("заводит дело со сроком и журнальной записью", async () => {
    const f = makeFakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await ensureCaseCore(f.prisma as any, INPUT);
    expect(id).toBe("case1");
    const created = f.state.cases["COMPANY:co1"] as AnyRec;
    expect((created.dueAt as Date).toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(created.slaSeconds).toBe(7 * 24 * 3600);
    expect(created.status).toBe("NEW");
    expect(f.state.events).toHaveLength(1);
    expect(f.state.events[0].kind).toBe("OPENED");
  });

  it("второй вызов не плодит второе дело", async () => {
    const f = makeFakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await ensureCaseCore(f.prisma as any, INPUT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await ensureCaseCore(f.prisma as any, INPUT);
    expect(b).toBe(a);
    expect(Object.keys(f.state.cases)).toHaveLength(1);
    expect(f.state.events).toHaveLength(1);
  });

  it("гонку двух заведений снимает P2002, а не падение", async () => {
    const f = makeFakePrisma();
    f.prisma.complianceCase.findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "case9" });
    f.prisma.complianceCase.create = vi.fn(async () => {
      const err = new Error("unique") as Error & { code?: string };
      err.code = "P2002";
      throw err;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureCaseCore(f.prisma as any, INPUT)).resolves.toBe("case9");
  });

  it("длинное название обрезается, а не роняет вставку", async () => {
    const f = makeFakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCaseCore(f.prisma as any, { ...INPUT, title: "я".repeat(500) });
    expect((f.state.cases["COMPANY:co1"].title as string).length).toBe(200);
  });
});
