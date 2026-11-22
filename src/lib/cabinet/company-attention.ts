/**
 * Что в предприятии требует внимания смотрящего (слайс BV). Спека
 * `docs/superpowers/specs/2026-11-22-company-requisites-doc-rubrics-design.md`, § 5.
 *
 * Два источника, и берёт их человек по-разному:
 *
 * - **покупатели** — непрочитанное магазина, и только у того, **у кого есть право
 *   `customers`** (BQ). До слайса число видел любой член команды, включая кладовщика,
 *   которому переписка магазина не положена вовсе: число сообщений — тоже сведения.
 * - **комплайнс** — непрочитанное в делах, где смотрящий **сам заявитель**
 *   (`applicantUserId`). Нитку дела по построению видит только он (AO), и значок у
 *   того, кто не может открыть нитку, зовёт человека в закрытую дверь.
 *
 * Дела предприятия — `COMPANY`, `KYB`, `COMPANY_REVISION` и `POINT`: всё, где объект
 * принадлежит самому предприятию. Заявки на товар (`PRODUCT_CLAIM`, `PRODUCT_REPORT`)
 * в счёт не идут — паспорт переживает предприятие, которое его набрало (BB), и дело
 * принадлежит товару, а не магазину.
 */
import type { CaseStatus, CaseSubjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { unreadCount } from "@/lib/cases/messages";
import { storeUnreadTotal } from "@/lib/customer-messages/read";
import { can, type TeamPermissions } from "@/lib/company-team/permissions";
import { NOT_DELETED } from "@/lib/soft-delete";

export type CaseAttention = {
  caseId: string;
  title: string;
  status: CaseStatus;
  unread: number;
};

export type CompanyAttention = {
  /** Непрочитанное магазина — ноль, если права на переписку нет. */
  customers: number;
  cases: CaseAttention[];
  /** Сумма для колокольчика на плитке. */
  total: number;
};

export const NO_ATTENTION: CompanyAttention = { customers: 0, cases: [], total: 0 };

/** Виды дел, объект которых принадлежит самому предприятию. */
export const COMPANY_CASE_TYPES: CaseSubjectType[] = [
  "COMPANY",
  "KYB",
  "COMPANY_REVISION",
  "POINT",
];

/**
 * Идентификаторы объектов предприятия, по которым ищутся его дела. Правки и точки
 * берутся списком: у дела нет колонки `companyId`, оно знает только вид и объект.
 */
async function companySubjectIds(companyId: string): Promise<string[]> {
  const [revisions, points] = await Promise.all([
    prisma.companyRevision.findMany({ where: { companyId }, select: { id: true }, take: 200 }),
    prisma.companyPoint.findMany({
      where: { companyId, ...NOT_DELETED },
      select: { id: true },
      take: 200,
    }),
  ]);
  return [companyId, ...revisions.map((r) => r.id), ...points.map((p) => p.id)];
}

export async function companyAttention(
  companyId: string,
  viewer: { userId: string; permissions: TeamPermissions },
): Promise<CompanyAttention> {
  const subjectIds = await companySubjectIds(companyId);
  const [customers, cases] = await Promise.all([
    can(viewer.permissions, "customers", "VIEW") ? storeUnreadTotal(companyId) : Promise.resolve(0),
    prisma.complianceCase.findMany({
      where: {
        applicantUserId: viewer.userId,
        subjectType: { in: COMPANY_CASE_TYPES },
        subjectId: { in: subjectIds },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        subjectType: true,
        messages: { select: { side: true, readByStaffAt: true, readByApplicantAt: true } },
      },
    }),
  ]);

  const rows: CaseAttention[] = [];
  for (const c of cases) {
    const unread = unreadCount(c.messages, "APPLICANT");
    if (unread === 0) continue;
    rows.push({ caseId: c.id, title: c.title, status: c.status, unread });
  }
  const total = customers + rows.reduce((sum, r) => sum + r.unread, 0);
  return { customers, cases: rows, total };
}
