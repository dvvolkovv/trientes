import { describe, expect, it } from "vitest";
import { planEscalation, type SweepCase } from "@/lib/points/report-sweep";

const T0 = new Date("2026-11-18T10:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86400_000);

const caseRow: SweepCase = {
  id: "c1",
  subjectId: "p1",
  applicantUserId: "owner1",
  caseTitle: "Reports: Shop",
  pointName: "Shop",
  underReviewAt: null,
  suspendedAt: null,
  reports: [
    { reporterUserId: null, reporterIpHash: "a", createdAt: T0 },
    { reporterUserId: null, reporterIpHash: "b", createdAt: T0 },
    { reporterUserId: null, reporterIpHash: "c", createdAt: T0 },
  ],
  askedAt: null,
  warnedAt: null,
  ownerRepliedAt: null,
};

describe("planEscalation", () => {
  it("три жалобы — пометка и вопрос", () => {
    expect(planEscalation(caseRow, T0)).toBe("REVIEW");
  });

  it("одна жалоба — ничего", () => {
    expect(planEscalation({ ...caseRow, reports: caseRow.reports.slice(0, 1) }, T0)).toBeNull();
  });

  it("две недели молчания после вопроса — предупреждение", () => {
    expect(planEscalation({ ...caseRow, underReviewAt: T0, askedAt: T0 }, days(15))).toBe("WARN");
  });

  it("ещё две недели — снятие", () => {
    expect(
      planEscalation({ ...caseRow, underReviewAt: T0, askedAt: T0, warnedAt: days(14) }, days(29)),
    ).toBe("SUSPEND");
  });

  it("предприятие ответило — лестница встала", () => {
    expect(
      planEscalation(
        { ...caseRow, underReviewAt: T0, askedAt: T0, ownerRepliedAt: days(2) },
        days(60),
      ),
    ).toBeNull();
  });

  it("уже снятая точка не эскалируется дальше", () => {
    expect(
      planEscalation(
        {
          ...caseRow,
          underReviewAt: T0,
          askedAt: T0,
          warnedAt: days(14),
          suspendedAt: days(28),
        },
        days(90),
      ),
    ).toBeNull();
  });
});
