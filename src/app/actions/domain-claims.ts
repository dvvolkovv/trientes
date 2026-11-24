"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireQueue } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { sendEmail } from "@/lib/email";
import { appendCaseEvent } from "@/lib/cases/journal";
import { INVITE_TTL_MS, hashToken, inviteToken, inviteUrl } from "@/lib/claims/invite";
import { rejectionEmail, welcomeEmail } from "@/lib/claims/letters";

/** Адрес сайта для ссылок письма: за nginx `req.url` указывает на localhost. */
function publicOrigin(): string {
  return (process.env.PUBLIC_ORIGIN ?? "https://trientes.org").replace(/\/+$/, "");
}

/**
 * Решение по заявке «это наш проект» (слайс CI).
 *
 * Одобрение не передаёт права немедленно: отправителю письма у нас не
 * принадлежит ни одна учётная запись. Оно отправляет приветственное письмо с
 * одноразовой ссылкой на каждый выбранный объект — ровно ту «поздравительную
 * открытку», которую просил владелец, и она же является передачей прав.
 */

const MIN_REASON = 3;

type Result = { ok: true; invites?: number } | { ok: false; reason: string };

async function claimCaseId(claimId: string): Promise<string | null> {
  const row = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "DOMAIN_CLAIM", subjectId: claimId } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Выбор цели галочкой: занятую выбрать нельзя — не эта дверь. */
export async function setClaimTarget(targetId: string, selected: boolean): Promise<Result> {
  const target = await prisma.domainClaimTarget.findUnique({
    where: { id: targetId },
    select: { id: true, owned: true, claimId: true, claim: { select: { status: true } } },
  });
  if (target === null) return { ok: false, reason: "not_found" };
  const gate = await requireQueue("domainClaims", "APPROVE");
  if (!gate.ok) return { ok: false, reason: gate.reason };
  if (target.claim.status !== "NEW") return { ok: false, reason: "already_decided" };
  if (selected && target.owned) return { ok: false, reason: "already_owned" };

  await prisma.domainClaimTarget.update({ where: { id: targetId }, data: { selected } });
  const caseId = await claimCaseId(target.claimId);
  if (caseId !== null) revalidatePath(`/[locale]/admin/cases/${caseId}`, "page");
  return { ok: true };
}

/**
 * Ответить проекту письмом из дела. Переписка с отправителем идёт письмами, а
 * не ниткой заявителя: учётной записи у него нет, а разговор должен остаться
 * в деле целиком.
 */
export async function replyToClaim(claimId: string, body: string): Promise<Result> {
  const text = (body ?? "").trim();
  if (text.length < MIN_REASON) return { ok: false, reason: "body_required" };
  const gate = await requireQueue("domainClaims", "HANDLE");
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const claim = await prisma.domainClaim.findUnique({
    where: { id: claimId },
    select: { id: true, fromAddress: true, provedDomain: true },
  });
  if (claim === null) return { ok: false, reason: "not_found" };

  const sent = await sendEmail({
    to: claim.fromAddress,
    subject: `Trientes — ${claim.provedDomain}`,
    text,
  });
  if (!sent.ok) return { ok: false, reason: "email_failed" };

  await prisma.domainClaimEmail.create({
    data: {
      claimId: claim.id,
      side: "STAFF",
      // Своего `Message-ID` мы не знаем (его ставит сервер), а строка обязана
      // быть уникальной — поэтому своим письмам даём своё имя.
      messageId: `staff-${claim.id}-${Date.now()}`,
      subject: `Trientes — ${claim.provedDomain}`,
      bodyText: text,
      fromAddress: process.env.SMTP_FROM_EMAIL ?? "noreply@trientes.org",
      toAddress: claim.fromAddress,
      receivedAt: new Date(),
      authorId: gate.userId,
    },
  });

  const caseId = await claimCaseId(claim.id);
  if (caseId !== null) {
    await appendCaseEvent({
      caseId,
      kind: "MESSAGE_SENT",
      actorId: gate.userId,
      payload: { body: text.slice(0, 300) },
    });
    revalidatePath(`/[locale]/admin/cases/${caseId}`, "page");
  }
  return { ok: true };
}

/**
 * Позвать наших специалистов: у проекта есть своё API, и стыковать его должен
 * инженер, а не проверяющий. Это эскалация «модератор → главный модератор →
 * IT» из просьбы владельца, и адресаты — владельцы: своей роли инженера в
 * правах нет, а звонок в пустоту хуже его отсутствия.
 */
export async function askEngineering(claimId: string, note: string): Promise<Result> {
  const text = (note ?? "").trim();
  if (text.length < MIN_REASON) return { ok: false, reason: "note_required" };
  const gate = await requireQueue("domainClaims", "HANDLE");
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const claim = await prisma.domainClaim.findUnique({
    where: { id: claimId },
    select: { id: true, provedDomain: true, needsEngineeringAt: true },
  });
  if (claim === null) return { ok: false, reason: "not_found" };

  const caseId = await claimCaseId(claim.id);
  await prisma.domainClaim.update({
    where: { id: claim.id },
    data: { needsEngineeringAt: new Date() },
  });

  const owners = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  for (const owner of owners) {
    // Один повод по одному делу не плодится: непрочитанный звонок обновляется
    // (правило прогона сроков в AO).
    const existing = await prisma.adminNotification.findFirst({
      where: { userId: owner.id, kind: "DOMAIN_CLAIM_ENGINEERING", subjectId: claim.id },
      select: { id: true },
    });
    const body = `API integration asked for ${claim.provedDomain}: ${text.slice(0, 300)}`;
    if (existing === null) {
      await prisma.adminNotification.create({
        data: {
          userId: owner.id,
          kind: "DOMAIN_CLAIM_ENGINEERING",
          caseId,
          subjectId: claim.id,
          title: `${claim.provedDomain} — API integration`,
          body,
        },
      });
    } else {
      await prisma.adminNotification.update({
        where: { id: existing.id },
        data: { body, readAt: null, createdAt: new Date() },
      });
    }
  }

  if (caseId !== null) {
    await appendCaseEvent({
      caseId,
      kind: "NOTE",
      actorId: gate.userId,
      payload: { note: `engineering asked: ${text.slice(0, 300)}` },
    });
    revalidatePath(`/[locale]/admin/cases/${caseId}`, "page");
  }
  return { ok: true };
}

/**
 * Одобрить заявку: выбранным объектам уходят приглашения одним письмом.
 *
 * Ни одной выбранной цели — отказ вслух: одобрить, ничего не передав, значит
 * закрыть дело молча.
 */
export async function approveDomainClaim(claimId: string, locale = "en"): Promise<Result> {
  const gate = await requireQueue("domainClaims", "APPROVE");
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const claim = await prisma.domainClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      status: true,
      provedDomain: true,
      fromAddress: true,
      targets: {
        select: { id: true, subjectKind: true, subjectId: true, subjectName: true, selected: true, owned: true },
      },
    },
  });
  if (claim === null) return { ok: false, reason: "not_found" };
  if (claim.status !== "NEW") return { ok: false, reason: "already_decided" };

  const chosen = claim.targets.filter((t) => t.selected && !t.owned);
  if (chosen.length === 0) return { ok: false, reason: "no_targets" };

  const origin = publicOrigin();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const links: { name: string; url: string }[] = [];
  for (const target of chosen) {
    const token = inviteToken();
    await prisma.domainClaimInvite.create({
      data: {
        claimId: claim.id,
        subjectKind: target.subjectKind,
        subjectId: target.subjectId,
        tokenHash: hashToken(token),
        email: claim.fromAddress,
        expiresAt,
      },
    });
    links.push({ name: target.subjectName, url: inviteUrl(origin, token, locale) });
  }

  const letter = welcomeEmail({
    domain: claim.provedDomain,
    links,
    forProjectsUrl: `${origin}/${locale}/for-projects`,
  });
  const sent = await sendEmail({ to: claim.fromAddress, subject: letter.subject, text: letter.text });
  if (!sent.ok) {
    // Письмо — и есть передача прав: без него одобрение ничего не передало бы,
    // а ссылки остались бы невыданными. Поэтому гасим их и отвечаем вслух.
    await prisma.domainClaimInvite.updateMany({
      where: { claimId: claim.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "email_failed" };
  }

  await prisma.domainClaim.update({
    where: { id: claim.id },
    data: { status: "APPROVED", decidedById: gate.userId, decidedAt: new Date() },
  });
  await prisma.domainClaimEmail.create({
    data: {
      claimId: claim.id,
      side: "STAFF",
      messageId: `welcome-${claim.id}-${Date.now()}`,
      subject: letter.subject,
      bodyText: letter.text,
      fromAddress: process.env.SMTP_FROM_EMAIL ?? "noreply@trientes.org",
      toAddress: claim.fromAddress,
      receivedAt: new Date(),
      authorId: gate.userId,
    },
  });
  await logAdminAction({
    actorId: gate.userId,
    action: "APPROVE_DOMAIN_CLAIM",
    targetType: "ComplianceCase",
    targetId: claim.id,
    details: {
      domain: claim.provedDomain,
      targets: chosen.map((t) => t.subjectName),
    },
  });

  const caseId = await claimCaseId(claim.id);
  if (caseId !== null) revalidatePath(`/[locale]/admin/cases/${caseId}`, "page");
  return { ok: true, invites: links.length };
}

/** Отклонить заявку: причина обязательна, письмо с ней уходит отправителю. */
export async function rejectDomainClaim(claimId: string, reason: string): Promise<Result> {
  const text = (reason ?? "").trim();
  if (text.length < MIN_REASON) return { ok: false, reason: "reason_required" };
  const gate = await requireQueue("domainClaims", "APPROVE");
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const claim = await prisma.domainClaim.findUnique({
    where: { id: claimId },
    select: { id: true, status: true, provedDomain: true, fromAddress: true },
  });
  if (claim === null) return { ok: false, reason: "not_found" };
  if (claim.status !== "NEW") return { ok: false, reason: "already_decided" };

  await prisma.domainClaim.update({
    where: { id: claim.id },
    data: {
      status: "REJECTED",
      decidedById: gate.userId,
      decidedAt: new Date(),
      rejectionReason: text,
    },
  });
  await prisma.domainClaimInvite.updateMany({
    where: { claimId: claim.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const letter = rejectionEmail({ domain: claim.provedDomain, reason: text });
  await sendEmail({ to: claim.fromAddress, subject: letter.subject, text: letter.text });
  await logAdminAction({
    actorId: gate.userId,
    action: "REJECT_DOMAIN_CLAIM",
    targetType: "ComplianceCase",
    targetId: claim.id,
    details: { domain: claim.provedDomain, reason: text.slice(0, 300) },
  });

  const caseId = await claimCaseId(claim.id);
  if (caseId !== null) revalidatePath(`/[locale]/admin/cases/${caseId}`, "page");
  return { ok: true };
}
