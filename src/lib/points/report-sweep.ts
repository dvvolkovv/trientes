import { prisma } from "@/lib/prisma";
import { appendCaseEvent } from "@/lib/cases/journal";
import { notifyApplicantOfMessage } from "@/lib/cases/notify-applicant";
import { pausePatch } from "@/lib/cases/sla";
import { rawMessage } from "@/lib/messages-raw";
import { escalationFor, independentReporters, type Escalation } from "./report-rules";

export type SweepStats = { checked: number; reviewed: number; warned: number; suspended: number };

export type SweepCase = {
  id: string;
  subjectId: string;
  applicantUserId: string | null;
  caseTitle: string;
  pointName: string;
  underReviewAt: Date | null;
  suspendedAt: Date | null;
  reports: { reporterUserId: string | null; reporterIpHash: string; createdAt: Date }[];
  askedAt: Date | null;
  warnedAt: Date | null;
  ownerRepliedAt: Date | null;
};

/** Чистая часть: что делать с этим делом прямо сейчас. */
export function planEscalation(row: SweepCase, now: Date): Escalation {
  return escalationFor({
    independent: independentReporters(row.reports, now),
    underReviewAt: row.underReviewAt,
    askedAt: row.askedAt,
    warnedAt: row.warnedAt,
    suspendedAt: row.suspendedAt,
    ownerRepliedAt: row.ownerRepliedAt,
    now,
  });
}

/** Английский текст на случай, если ключа перевода почему-то нет. */
const FALLBACK: Record<"asked" | "warned" | "suspended", string> = {
  asked:
    'We have received several reports about your location "{point}". Please confirm it is open and still accepts crypto, or correct its details.',
  warned:
    'We have had no answer about "{point}" for 14 days. Without a reply within another 14 days the location will be taken off the map until the matter is clarified.',
  suspended:
    '"{point}" has been taken off the map because the reports about it went unanswered. Reply here and we will put it back.',
};

/**
 * Сообщение предприятию пишет система, а не сотрудник: `authorId` пуст, сторона
 * STAFF. Текст — на языке кабинета владельца (тот же довод, что у письма сброса
 * пароля), и читается он не через `getTranslations`: прогон живёт в воркере, где
 * контекста запроса нет.
 */
async function writeToOwner(input: {
  caseId: string;
  applicantUserId: string | null;
  caseTitle: string;
  key: "asked" | "warned" | "suspended";
  point: string;
}): Promise<void> {
  const user = input.applicantUserId
    ? await prisma.user.findUnique({
        where: { id: input.applicantUserId },
        select: { preferredLocale: true },
      })
    : null;
  const body = await rawMessage(
    user?.preferredLocale,
    `notify.pointReport.${input.key}`,
    { point: input.point },
    FALLBACK[input.key],
  );

  await prisma.caseMessage.create({
    data: { caseId: input.caseId, authorId: null, side: "STAFF", body },
  });
  // Вопрос требует ответа — часы срока встают, как и у письма сотрудника.
  await prisma.complianceCase.update({
    where: { id: input.caseId },
    data: { status: "WAITING_APPLICANT", ...pausePatch(new Date()) },
  });
  if (input.applicantUserId) {
    await notifyApplicantOfMessage({
      applicantUserId: input.applicantUserId,
      caseId: input.caseId,
      caseTitle: input.caseTitle,
      preview: body.slice(0, 300),
    }).catch(() => {});
  }
}

/**
 * Ежедневная лестница: пометка и вопрос → предупреждение → снятие с карты.
 * Раз в сутки, а не раз в час: шаги считаются днями, и частый прогон ничего не
 * ускорит, зато умножит запросы.
 */
export async function runPointReportSweep(now: Date = new Date()): Promise<SweepStats> {
  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: "POINT_REPORT", status: { notIn: ["APPROVED", "REJECTED", "CLOSED"] } },
    select: { id: true, subjectId: true, applicantUserId: true, title: true },
    take: 200,
  });

  const stats: SweepStats = { checked: cases.length, reviewed: 0, warned: 0, suspended: 0 };

  for (const c of cases) {
    const point = await prisma.companyPoint.findUnique({
      where: { id: c.subjectId },
      select: { id: true, name: true, underReviewAt: true, suspendedAt: true },
    });
    if (!point) continue;

    const reports = await prisma.pointReport.findMany({
      where: { pointId: point.id },
      select: { reporterUserId: true, reporterIpHash: true, createdAt: true },
    });

    // Состояние лестницы читается из журнала: он неизменяем и уже есть, а новые
    // колонки под каждый шаг пришлось бы держать в согласии с ним руками.
    const events = await prisma.caseEvent.findMany({
      where: { caseId: c.id, kind: { in: ["POINT_ASKED", "POINT_WARNED"] } },
      select: { kind: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const askedAt = events.find((e) => e.kind === "POINT_ASKED")?.createdAt ?? null;
    const warnedAt = events.find((e) => e.kind === "POINT_WARNED")?.createdAt ?? null;

    const reply = await prisma.caseMessage.findFirst({
      where: { caseId: c.id, side: "APPLICANT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const row: SweepCase = {
      id: c.id,
      subjectId: point.id,
      applicantUserId: c.applicantUserId,
      caseTitle: c.title,
      pointName: point.name,
      underReviewAt: point.underReviewAt,
      suspendedAt: point.suspendedAt,
      reports,
      askedAt,
      warnedAt,
      ownerRepliedAt: reply?.createdAt ?? null,
    };

    const step = planEscalation(row, now);
    if (!step) continue;

    if (step === "REVIEW") {
      await prisma.companyPoint.update({ where: { id: point.id }, data: { underReviewAt: now } });
      await writeToOwner({
        caseId: c.id,
        applicantUserId: c.applicantUserId,
        caseTitle: c.title,
        key: "asked",
        point: point.name,
      });
      await appendCaseEvent({ caseId: c.id, kind: "POINT_ASKED", actorSide: "SYSTEM" });
      stats.reviewed += 1;
      continue;
    }

    if (step === "WARN") {
      await writeToOwner({
        caseId: c.id,
        applicantUserId: c.applicantUserId,
        caseTitle: c.title,
        key: "warned",
        point: point.name,
      });
      await appendCaseEvent({ caseId: c.id, kind: "POINT_WARNED", actorSide: "SYSTEM" });
      stats.warned += 1;
      continue;
    }

    await prisma.companyPoint.update({
      where: { id: point.id },
      data: { suspendedAt: now, suspendReason: "point_reports_unanswered" },
    });
    await writeToOwner({
      caseId: c.id,
      applicantUserId: c.applicantUserId,
      caseTitle: c.title,
      key: "suspended",
      point: point.name,
    });
    await appendCaseEvent({ caseId: c.id, kind: "POINT_SUSPENDED", actorSide: "SYSTEM" });
    stats.suspended += 1;
  }

  return stats;
}
