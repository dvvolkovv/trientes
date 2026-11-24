/**
 * Приглашение из приветственного письма (слайс CI).
 *
 * Письмо приходит с адреса, у которого нет учётной записи, поэтому передавать
 * права сразу некому: адрес почты — не человек у нас. Права получает тот, кто
 * пришёл по одноразовой ссылке, отправленной на доказанный адрес доказанного
 * домена; это та же механика, которой предприятие зовёт сотрудника
 * (`CompanyInvite`) и владелец зовёт проверяющего (`StaffInvite`).
 */

import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ClaimSubjectKind } from "@/lib/claims/domain-subject";

/** Две недели: столько же живут прочие приглашения проекта. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Больше приглашений на одну заявку не выдаём: это число целей, не попыток. */
export const MAX_INVITES_PER_CLAIM = 20;

export type InviteError =
  | "invalid"
  | "expired"
  | "accepted"
  | "revoked"
  | "already_owned"
  | "subject_gone";

type Db = PrismaClient | Prisma.TransactionClient;

/** Ссылка приглашения: угадать нельзя, в базе её нет — только отпечаток. */
export function inviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteUrl(origin: string, token: string, locale: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${locale}/project-invite/${token}`;
}

/**
 * Принять приглашение: объект достаётся вошедшему.
 *
 * Гонку двух переходов снимает условный `updateMany` по `acceptedAt: null` —
 * владение получает только первый, как у приглашения в команду.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  userId: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; subjectKind: ClaimSubjectKind; subjectId: string; claimId: string }
  | { ok: false; reason: InviteError }
> {
  const invite = await db.domainClaimInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      claimId: true,
      subjectKind: true,
      subjectId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });
  if (invite === null) return { ok: false, reason: "invalid" };
  if (invite.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (invite.acceptedAt !== null) return { ok: false, reason: "accepted" };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  // Объект мог обрести владельца между письмом и переходом: передавать его
  // этой дверью нельзя (та же причина, по которой занятая цель не выбирается).
  if (invite.subjectKind === "COIN_CARD") {
    const card = await db.coinCard.findUnique({
      where: { id: invite.subjectId },
      select: { stewardUserId: true, companyId: true },
    });
    if (card === null) return { ok: false, reason: "subject_gone" };
    if (card.stewardUserId !== null || card.companyId !== null) {
      return { ok: false, reason: "already_owned" };
    }
  } else {
    const row = await db.fintechCompany.findUnique({
      where: { id: invite.subjectId },
      select: { ownerUserId: true },
    });
    if (row === null) return { ok: false, reason: "subject_gone" };
    if (row.ownerUserId !== null) return { ok: false, reason: "already_owned" };
  }

  const taken = await db.domainClaimInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null },
    data: { acceptedAt: now, acceptedById: userId },
  });
  if (taken.count === 0) return { ok: false, reason: "accepted" };

  if (invite.subjectKind === "COIN_CARD") {
    await db.coinCard.update({
      where: { id: invite.subjectId },
      // Куратором становится тот, кто доказал домен письмом и пришёл по ссылке.
      // Уровень доверия поднимает не эта дверь: `trust` говорит о сверке
      // контракта и сети, а не о том, кто правит карточку.
      data: { stewardUserId: userId },
    });
  } else {
    await db.fintechCompany.update({
      where: { id: invite.subjectId },
      data: { ownerUserId: userId },
    });
  }

  return {
    ok: true,
    subjectKind: invite.subjectKind as ClaimSubjectKind,
    subjectId: invite.subjectId,
    claimId: invite.claimId,
  };
}
