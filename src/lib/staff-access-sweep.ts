/**
 * Суточный прогон пересмотра доступа. Права, выданные однажды, живут дольше
 * надобности в них: уволившийся проверяющий остаётся с правом утверждать, а
 * доступ «на одну проверку» — навсегда. Полгода — обычная частота ревизии
 * доступа в SOC 2 и ISO 27001; напоминание адресуется владельцам, потому что
 * выдавать и снимать права может только владелец.
 */
import { prisma } from "@/lib/prisma";
import { raiseAndNotify } from "@/lib/cases/admin-notify";

export type AccessReviewStats = { checked: number; due: number; notified: number; noOwner: number };

/**
 * Чистая часть. Отозванный доступ пересматривать нечего: прав у него уже нет,
 * а напоминание о нём было бы работой, которой не существует.
 */
export function reviewDue(
  row: { accessReviewAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  if (row.revokedAt) return false;
  return row.accessReviewAt.getTime() <= now.getTime();
}

export async function runStaffAccessReviewSweep(
  now: Date = new Date(),
): Promise<AccessReviewStats> {
  const stats: AccessReviewStats = { checked: 0, due: 0, notified: 0, noOwner: 0 };

  const members = await prisma.staffMember.findMany({
    where: { revokedAt: null },
    select: {
      userId: true,
      title: true,
      accessReviewAt: true,
      revokedAt: true,
      user: { select: { username: true, email: true } },
    },
    take: 500,
  });
  stats.checked = members.length;

  const overdue = members.filter((m) => reviewDue(m, now));
  stats.due = overdue.length;
  if (overdue.length === 0) return stats;

  // Владелец наследия (`ADMIN`) тоже владелец — политика читает его как OWNER.
  const owners = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  if (owners.length === 0) {
    stats.noOwner = overdue.length;
    return stats;
  }

  for (const m of overdue) {
    const who = m.user.username ?? m.user.email ?? m.userId;
    for (const owner of owners) {
      await raiseAndNotify({
        userId: owner.id,
        kind: "ACCESS_REVIEW_DUE",
        subjectId: m.userId,
        title: m.title ? `${who} — ${m.title}` : who,
        body: "Access review due: confirm the queues and levels, or revoke.",
        url: "/en/admin/staff",
      });
    }
    stats.notified += 1;
  }

  return stats;
}
