"use server";

/**
 * Действия владельца над доступом сотрудников. Все пять — под `requireOwner()`:
 * право выдавать права принадлежит владельцу, иначе утверждающий в одной
 * очереди выписал бы себе остальные семь.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import { parseGrants, accessReviewAt } from "@/lib/staff/invites";
import type { ParsedGrant } from "@/lib/staff/invites";

const MIN_REASON = 3;

type Target = { id: string; role: string };

/**
 * Цель выдачи. Владельцу и самому себе права не выдаются: у владельца они уже
 * все, а «выдать себе» — это обход правила четырёх глаз.
 */
async function resolveTarget(
  userId: string,
  actorId: string,
): Promise<{ ok: true; user: Target } | { ok: false; reason: "not_found" | "self_grant" | "owner_target" }> {
  if (userId === actorId) return { ok: false, reason: "self_grant" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return { ok: false, reason: "not_found" };
  if (user.role === "OWNER" || user.role === "ADMIN") return { ok: false, reason: "owner_target" };
  return { ok: true, user };
}

/** Прежние уровни по очередям — чтобы в журнал легло «было → стало». */
async function levelsOf(userId: string): Promise<Record<string, string>> {
  const rows = await prisma.staffGrant.findMany({ where: { userId }, select: { queue: true, level: true } });
  return Object.fromEntries(rows.map((r) => [r.queue, r.level]));
}

function diff(before: Record<string, string>, after: ParsedGrant[]) {
  const out: { queue: string; from: string | null; to: string | null }[] = [];
  const nextByQueue = new Map(after.map((g) => [g.queue, g.level]));
  for (const g of after) {
    if (before[g.queue] !== g.level) out.push({ queue: g.queue, from: before[g.queue] ?? null, to: g.level });
  }
  for (const queue of Object.keys(before)) {
    if (!nextByQueue.has(queue)) out.push({ queue, from: before[queue], to: null });
  }
  return out;
}

/**
 * Пакет прав целиком: отмеченное обновляется, неотмеченное удаляется. Удаление
 * лишних строк здесь обязательно — иначе снятая в матрице галочка оставляла бы
 * прежний уровень в базе, и экран врал бы про доступ.
 */
export async function setStaffGrants(input: { userId: string; grants: unknown }) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const target = await resolveTarget(input.userId, owner.userId);
  if (!target.ok) return { ok: false as const, reason: target.reason };

  const parsed = parseGrants(input.grants);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const member = await prisma.staffMember.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!member) return { ok: false as const, reason: "not_staff" as const };

  const before = await levelsOf(input.userId);
  const changes = diff(before, parsed.grants);

  for (const g of parsed.grants) {
    await prisma.staffGrant.upsert({
      where: { userId_queue: { userId: input.userId, queue: g.queue } },
      update: { level: g.level, expiresAt: g.expiresAt, grantedById: owner.userId },
      create: {
        userId: input.userId,
        queue: g.queue,
        level: g.level,
        expiresAt: g.expiresAt,
        grantedById: owner.userId,
      },
    });
  }
  await prisma.staffGrant.deleteMany({
    where: { userId: input.userId, queue: { notIn: parsed.grants.map((g) => g.queue) } },
  });

  if (changes.length > 0) {
    await logAdminAction({
      actorId: owner.userId,
      action: "STAFF_ACCESS_CHANGED",
      targetType: "User",
      targetId: input.userId,
      details: { changes },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true as const, changed: changes.length };
}

/**
 * Отзыв доступа. Строку сотрудника не удаляем: журнал решений должен читаться,
 * а удаление человека стёрло бы, кто что решал. Гранты тоже остаются — вернуть
 * доступ должно быть одним действием, а не повторной выдачей восьми прав.
 */
export async function revokeStaffAccess(input: { userId: string; reason: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false as const, reason: "reason_too_short" as const };

  const target = await resolveTarget(input.userId, owner.userId);
  if (!target.ok) return { ok: false as const, reason: target.reason };

  const r = await prisma.staffMember.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: owner.userId, revokeReason: reason },
  });
  if (r.count === 0) return { ok: false as const, reason: "not_staff" as const };

  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_ACCESS_REVOKED",
    targetType: "User",
    targetId: input.userId,
    details: { reason },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function restoreStaffAccess(input: { userId: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const target = await resolveTarget(input.userId, owner.userId);
  if (!target.ok) return { ok: false as const, reason: target.reason };

  const r = await prisma.staffMember.updateMany({
    where: { userId: input.userId, revokedAt: { not: null } },
    data: { revokedAt: null, revokedById: null, revokeReason: null },
  });
  if (r.count === 0) return { ok: false as const, reason: "not_revoked" as const };

  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_ACCESS_RESTORED",
    targetType: "User",
    targetId: input.userId,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Пересмотр прошёл: следующий срок через полгода, непрочитанный звонок гаснет —
 * иначе владелец видел бы напоминание о работе, которую уже сделал.
 */
export async function markAccessReviewPassed(input: { userId: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const member = await prisma.staffMember.findUnique({
    where: { userId: input.userId },
    select: { id: true },
  });
  if (!member) return { ok: false as const, reason: "not_staff" as const };

  const next = accessReviewAt(new Date());
  await prisma.staffMember.update({ where: { userId: input.userId }, data: { accessReviewAt: next } });
  await prisma.adminNotification.updateMany({
    where: { kind: "ACCESS_REVIEW_DUE", subjectId: input.userId, readAt: null },
    data: { readAt: new Date() },
  });
  await logAdminAction({
    actorId: owner.userId,
    action: "ACCESS_REVIEW_PASSED",
    targetType: "User",
    targetId: input.userId,
    details: { nextReviewAt: next.toISOString() },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, nextReviewAt: next };
}

/**
 * Позвать человека, у которого аккаунт уже есть — по логину или адресу. Для
 * тех, у кого аккаунта нет, есть ссылка-приглашение (`staff-invites.ts`).
 */
export async function grantStaffByIdentifier(input: {
  identifier: string;
  title?: string;
  duties?: string;
  grants: unknown;
}) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const parsed = parseGrants(input.grants);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const needle = input.identifier.trim().toLowerCase();
  if (!needle) return { ok: false as const, reason: "not_found" as const };
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: needle }, { email: needle }] },
    select: { id: true, role: true, preferredLocale: true },
  });
  if (!user) return { ok: false as const, reason: "not_found" as const };

  const target = await resolveTarget(user.id, owner.userId);
  if (!target.ok) return { ok: false as const, reason: target.reason };

  await prisma.staffMember.upsert({
    where: { userId: user.id },
    update: {
      title: input.title?.trim() || null,
      duties: input.duties?.trim() || null,
      // Позвали заново — доступ снова действует: иначе владелец выдал бы права
      // отозванному сотруднику и не понял, почему тот не видит админку.
      revokedAt: null,
      revokedById: null,
      revokeReason: null,
    },
    create: {
      userId: user.id,
      title: input.title?.trim() || null,
      duties: input.duties?.trim() || null,
      invitedById: owner.userId,
      accessReviewAt: accessReviewAt(new Date()),
    },
  });
  if (user.role === "USER") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "STAFF" } });
  }

  const before = await levelsOf(user.id);
  for (const g of parsed.grants) {
    await prisma.staffGrant.upsert({
      where: { userId_queue: { userId: user.id, queue: g.queue } },
      update: { level: g.level, expiresAt: g.expiresAt, grantedById: owner.userId },
      create: {
        userId: user.id,
        queue: g.queue,
        level: g.level,
        expiresAt: g.expiresAt,
        grantedById: owner.userId,
      },
    });
  }
  await prisma.staffGrant.deleteMany({
    where: { userId: user.id, queue: { notIn: parsed.grants.map((g) => g.queue) } },
  });

  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_ACCESS_CHANGED",
    targetType: "User",
    targetId: user.id,
    details: { changes: diff(before, parsed.grants), invited: true },
  });

  await notifyUser({
    userId: user.id,
    subject: "Trientes — compliance access granted",
    text: `You have been granted compliance access on trientes.org (${parsed.grants
      .map((g) => `${g.queue}: ${g.level.toLowerCase()}`)
      .join(", ")}).`,
    url: `/${user.preferredLocale}/admin/queues`,
  }).catch((e) => console.error("[staff-access] notify failed:", e));

  revalidatePath("/", "layout");
  return { ok: true as const, userId: user.id };
}
