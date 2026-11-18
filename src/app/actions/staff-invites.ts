"use server";

/**
 * Ссылка-приглашение сотрудника — для тех, у кого аккаунта ещё нет (по логину
 * зовёт `grantStaffByIdentifier`). В базе лежит только sha256 ссылки: дамп
 * таблицы не должен давать доступ к админке.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireOwner } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import {
  MAX_ACTIVE_INVITES,
  accessReviewAt,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteState,
  parseGrants,
  type ParsedGrant,
} from "@/lib/staff/invites";

export async function createStaffInvite(input: {
  identifier?: string;
  title?: string;
  duties?: string;
  grants: unknown;
}) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  const parsed = parseGrants(input.grants);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const active = await prisma.staffInvite.count({
    where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (active >= MAX_ACTIVE_INVITES) return { ok: false as const, reason: "too_many" as const };

  // Токен возвращается один раз: в базе хэш, и повторно ссылку не узнать.
  const token = generateInviteToken();
  const invite = await prisma.staffInvite.create({
    data: {
      tokenHash: hashInviteToken(token),
      identifier: input.identifier?.trim().toLowerCase() || null,
      title: input.title?.trim() || null,
      duties: input.duties?.trim() || null,
      grants: parsed.grants.map((g) => ({
        queue: g.queue,
        level: g.level,
        expiresAt: g.expiresAt?.toISOString() ?? null,
      })),
      invitedById: owner.userId,
      expiresAt: inviteExpiry(),
    },
    select: { id: true, expiresAt: true },
  });

  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_INVITED",
    targetType: "User",
    targetId: owner.userId,
    details: {
      inviteId: invite.id,
      identifier: input.identifier?.trim().toLowerCase() || null,
      grants: parsed.grants.map((g) => ({ queue: g.queue, level: g.level })),
    },
  });

  revalidatePath("/", "layout");
  return { ok: true as const, inviteId: invite.id, token, expiresAt: invite.expiresAt };
}

export async function revokeStaffInvite(input: { inviteId: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false as const, reason: owner.reason };

  // Условие на acceptedAt: уже принятая ссылка остаётся в своём конечном
  // состоянии, отзывать нужно выданный доступ, а не ссылку.
  const r = await prisma.staffInvite.updateMany({
    where: { id: input.inviteId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) return { ok: false as const, reason: "invalid" as const };

  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_INVITE_REVOKED",
    targetType: "User",
    targetId: owner.userId,
    details: { inviteId: input.inviteId },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Приём. Охранник тут не `requireOwner` и не `requireStaff`: приглашение
 * принимает человек, у которого прав ещё нет — доступ даёт сама ссылка.
 */
export async function acceptStaffInvite(input: { token: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash: hashInviteToken(input.token) },
    select: {
      id: true,
      title: true,
      duties: true,
      grants: true,
      invitedById: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });
  if (!invite) return { ok: false as const, reason: "invalid" as const };

  const state = inviteState(invite);
  if (state !== "valid") return { ok: false as const, reason: state };

  const parsed = parseGrants(invite.grants);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  // Одноразовость держит условное обновление: два одновременных перехода по
  // одной ссылке тронут строку только один раз (приём из приглашений компании).
  const claimed = await prisma.staffInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedById: userId },
  });
  if (claimed.count === 0) return { ok: false as const, reason: "accepted" as const };

  await applyGrants({
    userId,
    grants: parsed.grants,
    title: invite.title,
    duties: invite.duties,
    invitedById: invite.invitedById,
  });

  const joiner = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, email: true, preferredLocale: true },
  });
  await notifyUser({
    userId: invite.invitedById,
    subject: "Trientes — compliance invite accepted",
    text: `${joiner?.username ?? joiner?.email ?? userId} accepted the compliance access invite (${parsed.grants
      .map((g) => `${g.queue}: ${g.level.toLowerCase()}`)
      .join(", ")}).`,
    url: `/${joiner?.preferredLocale ?? "en"}/admin/staff`,
  }).catch((e) => console.error("[staff-invites] notify failed:", e));

  revalidatePath("/", "layout");
  return { ok: true as const };
}

async function applyGrants(input: {
  userId: string;
  grants: ParsedGrant[];
  title: string | null;
  duties: string | null;
  invitedById: string;
}): Promise<void> {
  await prisma.staffMember.upsert({
    where: { userId: input.userId },
    update: {
      title: input.title,
      duties: input.duties,
      revokedAt: null,
      revokedById: null,
      revokeReason: null,
    },
    create: {
      userId: input.userId,
      title: input.title,
      duties: input.duties,
      invitedById: input.invitedById,
      accessReviewAt: accessReviewAt(new Date()),
    },
  });

  // Владельца не понижаем: он принял ссылку не для того, чтобы потерять права.
  const u = await prisma.user.findUnique({ where: { id: input.userId }, select: { role: true } });
  if (u?.role === "USER") {
    await prisma.user.update({ where: { id: input.userId }, data: { role: "STAFF" } });
  }

  for (const g of input.grants) {
    await prisma.staffGrant.upsert({
      where: { userId_queue: { userId: input.userId, queue: g.queue } },
      update: { level: g.level, expiresAt: g.expiresAt, grantedById: input.invitedById },
      create: {
        userId: input.userId,
        queue: g.queue,
        level: g.level,
        expiresAt: g.expiresAt,
        grantedById: input.invitedById,
      },
    });
  }
}

/** Что именно выдают по ссылке — для экрана приёма. Токен в базе не ищется по равенству строки. */
export async function peekStaffInvite(token: string) {
  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      title: true,
      duties: true,
      grants: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { username: true, email: true } },
    },
  });
  if (!invite) return { ok: false as const, reason: "invalid" as const };
  const state = inviteState(invite);
  if (state !== "valid") return { ok: false as const, reason: state };
  const parsed = parseGrants(invite.grants);
  return {
    ok: true as const,
    title: invite.title,
    duties: invite.duties,
    invitedBy: invite.invitedBy.username ?? invite.invitedBy.email ?? null,
    grants: parsed.ok ? parsed.grants.map((g) => ({ queue: g.queue, level: g.level })) : [],
  };
}
