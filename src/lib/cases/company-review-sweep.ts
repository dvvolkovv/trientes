import type { CaseRisk } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextReviewAt, reviewDueSoon } from "@/lib/company-visibility";
import { raiseAndNotify } from "./admin-notify";
import { appendCaseEvent } from "./journal";
import { computeDue } from "./sla";
import { isOpen } from "./types";

export type ReviewStats = {
  checked: number;
  opened: number;
  backfilled: number;
  rang: number;
  reopened: number;
  noAddressee: number;
};

export type ReviewStep = { setNextReviewAt: Date | null; ring: boolean };

/**
 * Чистая часть: что делать с этим предприятием прямо сейчас.
 *
 * Пустую дату наверстываем **молча** — это не событие, а наверстывание: у
 * предприятий, залистованных до слайса AR, срока пересмотра взяться неоткуда,
 * и ждать, пока человек нажмёт кнопку, значит не пересматривать их никогда.
 */
export function planReview(
  row: { nextReviewAt: Date | null; risk: CaseRisk; listedAt: Date | null },
  now: Date,
): ReviewStep {
  if (!row.nextReviewAt) {
    if (!row.listedAt) return { setNextReviewAt: null, ring: false };
    const due = nextReviewAt(row.listedAt, row.risk);
    return { setNextReviewAt: due, ring: reviewDueSoon(due, now) };
  }
  return { setNextReviewAt: null, ring: reviewDueSoon(row.nextReviewAt, now) };
}

/**
 * Звонок адресный. Проверявший, иначе взявший, иначе утвердивший дело, иначе
 * тот, кто одобрил саму компанию на старом экране (у залистованных до слайса
 * AN подписи дела пусты, а одобривший в `Company.reviewedById` есть).
 *
 * Некому звонить — молчим и пишем в лог: безадресный звонок будит всех
 * админов, и его перестают читать (тот же довод, что в AQ).
 */
export function reviewAddressee(c: {
  reviewedById: string | null;
  assigneeId: string | null;
  approvedById: string | null;
  companyReviewedById?: string | null;
}): string | null {
  return c.reviewedById ?? c.assigneeId ?? c.approvedById ?? c.companyReviewedById ?? null;
}

/**
 * Что делать, когда срок подошёл.
 *
 * Есть адресат — звоним ему. Нет (у залистованного до слайса AN подписей в
 * деле не бывает) — **открываем дело заново**: пересмотр это работа, и она
 * должна лежать в очереди, где её возьмёт человек, а не пропадать в логе.
 * Дело, решённое уже в самой системе, открывать заново нельзя: у него есть
 * решение, и повторное одобрение прошло бы мимо объекта (`not_pending`).
 */
export function reviewAction(input: {
  addressee: string | null;
  decision: "APPROVED" | "REJECTED" | null;
  open: boolean;
}): "BELL" | "REOPEN" | "NONE" {
  if (input.addressee) return "BELL";
  if (input.open) return "NONE"; // дело и так в очереди — звать некого и незачем
  return input.decision === null ? "REOPEN" : "NONE";
}

type CompanyRow = {
  id: string;
  displayName: string;
  ownerUserId: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedById: string | null;
};

/**
 * Дело для предприятия, залистованного до того, как дела появились.
 *
 * Заводится **уже решённым** (`status: APPROVED`), но **без решения**
 * (`decision: null`): решение принималось на старом экране, а не здесь, и
 * записать его сюда значило бы приписать сотруднику работу, которой в деле не
 * было — аналитика считает именно `decision != null`. Открытым его заводить
 * нельзя тем более: дело повисло бы в очереди с просроченным сроком.
 */
async function openSettledCase(company: CompanyRow): Promise<string | null> {
  const openedAt = company.reviewedAt ?? company.createdAt;
  const { dueAt, slaSeconds } = computeDue(openedAt, "COMPANY");
  try {
    const created = await prisma.complianceCase.create({
      data: {
        subjectType: "COMPANY",
        subjectId: company.id,
        title: company.displayName.slice(0, 200),
        applicantUserId: company.ownerUserId,
        status: "APPROVED",
        openedAt,
        dueAt,
        slaSeconds,
        decidedAt: company.reviewedAt,
      },
    });
    await appendCaseEvent({
      caseId: created.id,
      actorSide: "SYSTEM",
      kind: "OPENED",
      payload: { title: company.displayName.slice(0, 200), backfilled: 1 },
    });
    return created.id;
  } catch (err) {
    // Параллельный прогон или заведение дела из экрана надзора — у объекта
    // ровно одно дело, и это нормальный исход, а не сбой.
    if ((err as { code?: string }).code === "P2002") return null;
    console.error("[company-review] failed to open case", { companyId: company.id, err });
    return null;
  }
}

/**
 * Суточный прогон: за 30 дней до срока пересмотра звонит колокольчик.
 *
 * Идём от предприятий, а не от дел: у залистованного до слайса AN дела нет, и
 * прогон по делам не увидел бы его никогда — то есть пересмотр не наступил бы
 * вообще. Автоматической приостановки тут нет и не будет: предприятие — это
 * договор, его не разрывают часы.
 */
export async function runCompanyReviewSweep(now: Date = new Date()): Promise<ReviewStats> {
  const stats: ReviewStats = {
    checked: 0,
    opened: 0,
    backfilled: 0,
    rang: 0,
    reopened: 0,
    noAddressee: 0,
  };

  const companies = await prisma.company.findMany({
    where: { status: "APPROVED", deletedAt: null },
    select: {
      id: true,
      displayName: true,
      ownerUserId: true,
      createdAt: true,
      reviewedAt: true,
      reviewedById: true,
    },
    take: 500,
  });
  if (companies.length === 0) return stats;

  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: "COMPANY", subjectId: { in: companies.map((c) => c.id) } },
    select: {
      id: true,
      title: true,
      risk: true,
      nextReviewAt: true,
      subjectId: true,
      status: true,
      decision: true,
      reviewedById: true,
      assigneeId: true,
      approvedById: true,
    },
  });
  const byCompany = new Map(cases.map((c) => [c.subjectId, c]));

  for (const company of companies) {
    stats.checked += 1;
    let c = byCompany.get(company.id);
    if (!c) {
      const id = await openSettledCase(company);
      if (!id) continue;
      stats.opened += 1;
      c = {
        id,
        title: company.displayName,
        risk: "MEDIUM",
        nextReviewAt: null,
        subjectId: company.id,
        status: "APPROVED",
        decision: null,
        reviewedById: null,
        assigneeId: null,
        approvedById: null,
      };
    }

    // Одобрения в базе может не быть вовсе (запись старше, чем учёт решений
    // модератора) — тогда считаем от заведения: залистовано оно во всяком
    // случае не раньше.
    const step = planReview(
      {
        nextReviewAt: c.nextReviewAt,
        risk: c.risk,
        listedAt: company.reviewedAt ?? company.createdAt,
      },
      now,
    );
    if (step.setNextReviewAt) {
      await prisma.complianceCase.update({
        where: { id: c.id },
        data: { nextReviewAt: step.setNextReviewAt },
      });
      stats.backfilled += 1;
    }
    if (!step.ring) continue;

    const to = reviewAddressee({ ...c, companyReviewedById: company.reviewedById });
    const action = reviewAction({
      addressee: to,
      decision: c.decision,
      open: isOpen(c.status),
    });

    if (action === "BELL" && to) {
      await raiseAndNotify({ userId: to, kind: "REVIEW_DUE", caseId: c.id, title: c.title });
      stats.rang += 1;
      continue;
    }

    if (action === "REOPEN") {
      // Срок считаем заново от сегодняшнего дня: это новая работа, а не
      // доедание срока, назначенного при листинге год назад.
      const { dueAt, slaSeconds } = computeDue(now, "COMPANY");
      await prisma.complianceCase.update({
        where: { id: c.id },
        data: { status: "NEW", dueAt, slaSeconds, clockStoppedAt: null },
      });
      await appendCaseEvent({
        caseId: c.id,
        actorSide: "SYSTEM",
        kind: "STATUS_CHANGED",
        payload: { from: c.status, to: "NEW", why: "review_due" },
      });
      stats.reopened += 1;
      continue;
    }

    stats.noAddressee += 1;
  }

  return stats;
}
