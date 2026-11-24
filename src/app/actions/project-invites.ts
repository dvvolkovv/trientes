"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { acceptInvite, hashToken, type InviteError } from "@/lib/claims/invite";
import { appendCaseEvent } from "@/lib/cases/journal";

/**
 * Приём приглашения проекта (слайс CI).
 *
 * Охранников прав здесь нет и быть не может: приходит человек, у которого прав
 * ещё нет, — право даёт сама ссылка, отправленная на доказанный адрес
 * доказанного домена (то же, что у `staff-invite` и приглашения в команду).
 */

export type PeekResult =
  | {
      ok: true;
      subjectKind: "COIN_CARD" | "FINTECH";
      subjectName: string;
      domain: string;
      /** Куда ведёт объект после принятия. */
      manageHref: string;
    }
  | { ok: false; reason: InviteError };

export async function peekProjectInvite(token: string, locale: string): Promise<PeekResult> {
  const invite = await prisma.domainClaimInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      subjectKind: true,
      subjectId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      claim: { select: { provedDomain: true } },
    },
  });
  if (invite === null) return { ok: false, reason: "invalid" };
  if (invite.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (invite.acceptedAt !== null) return { ok: false, reason: "accepted" };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  if (invite.subjectKind === "COIN_CARD") {
    const card = await prisma.coinCard.findUnique({
      where: { id: invite.subjectId },
      select: { id: true, name: true, symbol: true },
    });
    if (card === null) return { ok: false, reason: "subject_gone" };
    return {
      ok: true,
      subjectKind: "COIN_CARD",
      subjectName: `${card.name} (${card.symbol})`,
      domain: invite.claim.provedDomain,
      manageHref: `/${locale}/cabinet/coins/${card.id}`,
    };
  }

  const row = await prisma.fintechCompany.findUnique({
    where: { id: invite.subjectId },
    select: { id: true, displayName: true },
  });
  if (row === null) return { ok: false, reason: "subject_gone" };
  return {
    ok: true,
    subjectKind: "FINTECH",
    subjectName: row.displayName,
    domain: invite.claim.provedDomain,
    manageHref: `/${locale}/business/fintech`,
  };
}

export async function acceptProjectInvite(input: {
  token: string;
  locale: string;
}): Promise<{ ok: true; href: string } | { ok: false; reason: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const res = await acceptInvite(prisma, input.token, userId);
  if (!res.ok) return { ok: false, reason: res.reason };

  // В журнале дела остаётся, что права действительно ушли: одобрение само по
  // себе ничего не передавало — передал переход по ссылке.
  const caseRow = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "DOMAIN_CLAIM", subjectId: res.claimId } },
    select: { id: true },
  });
  if (caseRow !== null) {
    await appendCaseEvent({
      caseId: caseRow.id,
      kind: "NOTE",
      actorId: userId,
      actorSide: "APPLICANT",
      payload: { note: `invite accepted: ${res.subjectKind} ${res.subjectId}` },
    });
  }

  return {
    ok: true,
    href:
      res.subjectKind === "COIN_CARD"
        ? `/${input.locale}/cabinet/coins/${res.subjectId}`
        : `/${input.locale}/business/fintech`,
  };
}
