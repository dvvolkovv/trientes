/**
 * Кандидаты во вторую подпись: владельцы и сотрудники с правами в очередях
 * этого объекта. Одна реализация на действие и на страницу — иначе кнопка и
 * охранник разошлись бы в понимании того, есть ли кому утвердить.
 */
import type { CaseSubjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { countApprovers, type ApproverRow } from "@/lib/cases/approval";
import { SUBJECT_QUEUES } from "@/lib/authz/map";

export async function approverRows(subjectType: CaseSubjectType): Promise<ApproverRow[]> {
  const queues = SUBJECT_QUEUES[subjectType];
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: ["OWNER", "ADMIN"] } },
        { role: "STAFF", staffGrants: { some: { queue: { in: queues } } } },
      ],
    },
    select: {
      id: true,
      role: true,
      staffMember: { select: { revokedAt: true } },
      staffGrants: { where: { queue: { in: queues } }, select: { level: true, expiresAt: true } },
    },
  });

  const rows: ApproverRow[] = [];
  for (const u of users) {
    const revokedAt = u.staffMember?.revokedAt ?? null;
    const role = u.role as ApproverRow["role"];
    if (u.staffGrants.length === 0) {
      rows.push({ userId: u.id, level: null, expiresAt: null, revokedAt, role });
      continue;
    }
    for (const g of u.staffGrants) {
      rows.push({ userId: u.id, level: g.level, expiresAt: g.expiresAt, revokedAt, role });
    }
  }
  return rows;
}

export async function countOtherApprovers(
  subjectType: CaseSubjectType,
  exceptUserId: string,
  now: Date = new Date(),
): Promise<number> {
  return countApprovers(await approverRows(subjectType), exceptUserId, now);
}
