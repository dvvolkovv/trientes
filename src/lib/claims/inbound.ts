/**
 * Приём письма «это наш проект»: от письма к заявке, целям и делу (слайс CI).
 *
 * Решение о правах принимает человек в очереди — так просил владелец, и так
 * правильно: письмо доказывает домен, а не то, что отправитель представляет
 * проект. Код здесь решает только одно: есть ли доказательство и к каким
 * нашим объектам оно относится.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { provedDomains, fromAddress, type ProofKind } from "@/lib/claims/email-auth";
import {
  domainMatches,
  siteDomain,
  subjectDomain,
  type ClaimSubjectKind,
  type DomainMatch,
} from "@/lib/claims/domain-subject";
import type { InboundMessage } from "@/lib/claims/mailbox";

/** Больше открытых дел на один домен не заводим: это уже разговор, а не заявки. */
export const MAX_OPEN_PER_DOMAIN = 5;
/** Писем с одного домена в сутки: остальные остаются в ящике. */
export const MAX_EMAILS_PER_DOMAIN_DAY = 20;

export type InboundOutcome =
  | { kind: "claimed"; claimId: string; caseId: string | null; targets: number }
  | { kind: "appended"; claimId: string }
  | { kind: "skipped"; reason: SkipReason };

export type SkipReason =
  | "already_read"
  | "no_from"
  | "no_proof"
  | "no_subject_match"
  | "too_many_open"
  | "too_many_today";

export type TargetCandidate = {
  subjectKind: ClaimSubjectKind;
  subjectId: string;
  subjectName: string;
  subjectDomain: string;
  match: DomainMatch;
  owned: boolean;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Имя отправителя из `From` — для дела, чтобы строка читалась рассказом.
 * Доказательством оно не является: имя пишет сам отправитель.
 */
export function displayName(from: string): string | null {
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(from ?? "");
  const name = (m?.[1] ?? "").trim();
  return name === "" ? null : name.slice(0, 120);
}

/**
 * Кандидаты среди наших объектов для доказанного домена.
 *
 * Один домен отвечает нескольким объектам сразу — у `crypto.com` есть и
 * запись финтех-каталога, и монета, — поэтому ищем всех: модератор выберет, что
 * передать, одним решением, а не разбирая несколько одинаковых дел.
 */
export async function findTargets(
  db: Db,
  provedDomain: string,
): Promise<TargetCandidate[]> {
  const out: TargetCandidate[] = [];

  const cards = await db.coinCard.findMany({
    where: { status: "APPROVED" },
    select: {
      id: true,
      name: true,
      symbol: true,
      links: true,
      stewardUserId: true,
      companyId: true,
      coin: { select: { websiteUrl: true } },
    },
  });
  for (const card of cards) {
    const domain = subjectDomain({
      kind: "COIN_CARD",
      links: card.links,
      coinWebsiteUrl: card.coin?.websiteUrl ?? null,
    });
    if (domain === null) continue;
    const match = domainMatches(provedDomain, domain);
    if (match === null) continue;
    out.push({
      subjectKind: "COIN_CARD",
      subjectId: card.id,
      subjectName: `${card.name} (${card.symbol})`,
      subjectDomain: domain,
      match,
      owned: card.stewardUserId !== null || card.companyId !== null,
    });
  }

  const fintechs = await db.fintechCompany.findMany({
    where: { status: "APPROVED" },
    select: { id: true, displayName: true, website: true, ownerUserId: true },
  });
  for (const row of fintechs) {
    const domain = siteDomain(row.website);
    if (domain === null) continue;
    const match = domainMatches(provedDomain, domain);
    if (match === null) continue;
    out.push({
      subjectKind: "FINTECH",
      subjectId: row.id,
      subjectName: row.displayName,
      subjectDomain: domain,
      match,
      owned: row.ownerUserId !== null,
    });
  }

  return out;
}

/** Самое сильное совпадение заявки: равенство сильнее родителя, тот — поддомена. */
export function strongestMatch(targets: readonly TargetCandidate[]): DomainMatch {
  if (targets.some((t) => t.match === "EXACT")) return "EXACT";
  if (targets.some((t) => t.match === "PARENT")) return "PARENT";
  return "SUBDOMAIN";
}

/**
 * Разобрать одно письмо.
 *
 * Порядок проверок — порядок их силы: прочитанное письмо не разбираем вовсе,
 * письмо без доказанного домена заявки не заводит (иначе «домен совпал» в деле
 * означало бы проверку, которой не было), и только потом считаются потолки.
 */
export async function acceptInbound(
  message: InboundMessage,
  authServer: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<InboundOutcome> {
  const existing = await db.domainClaimEmail.findUnique({
    where: { messageId: message.messageId },
    select: { id: true },
  });
  if (existing !== null) return { kind: "skipped", reason: "already_read" };

  const address = fromAddress(message.from);
  if (address === null) return { kind: "skipped", reason: "no_from" };

  const proved = provedDomains(message.authResults, authServer, message.from);
  if (proved.length === 0) return { kind: "skipped", reason: "no_proof" };

  // Доказанных доменов бывает несколько (домен проекта и домен рассыльщика).
  // Берём тот, который сошёлся с нашими объектами; если сошлись оба — тот, у
  // кого совпадение сильнее.
  let best: { domain: string; proof: ProofKind; targets: TargetCandidate[] } | null = null;
  for (const candidate of proved) {
    const targets = await findTargets(db, candidate.domain);
    if (targets.length === 0) continue;
    const strength = strongestMatch(targets);
    if (
      best === null ||
      (strength === "EXACT" && strongestMatch(best.targets) !== "EXACT") ||
      (strength === "PARENT" && strongestMatch(best.targets) === "SUBDOMAIN")
    ) {
      best = { domain: candidate.domain, proof: candidate.proof, targets };
    }
  }
  if (best === null) return { kind: "skipped", reason: "no_subject_match" };

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const todayCount = await db.domainClaimEmail.count({
    where: { side: "PROJECT", receivedAt: { gte: since }, claim: { provedDomain: best.domain } },
  });
  if (todayCount >= MAX_EMAILS_PER_DOMAIN_DAY) {
    return { kind: "skipped", reason: "too_many_today" };
  }

  // Открытая заявка того же домена — это продолжение разговора, а не новая
  // заявка: письмо ложится в неё строкой (тот же мотив, что у дела одного
  // объекта — одно дело).
  const open = await db.domainClaim.findFirst({
    where: { provedDomain: best.domain, status: "NEW" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open !== null) {
    await db.domainClaimEmail.create({
      data: {
        claimId: open.id,
        side: "PROJECT",
        messageId: message.messageId,
        subject: message.subject?.slice(0, 300) ?? null,
        bodyText: message.bodyText,
        fromAddress: address,
        toAddress: message.to?.slice(0, 300) ?? null,
        authRaw: message.authResults[0]?.slice(0, 4_000) ?? null,
        receivedAt: message.receivedAt,
      },
    });
    return { kind: "appended", claimId: open.id };
  }

  const openCount = await db.domainClaim.count({
    where: { provedDomain: best.domain, status: "NEW" },
  });
  if (openCount >= MAX_OPEN_PER_DOMAIN) {
    return { kind: "skipped", reason: "too_many_open" };
  }

  const claim = await db.domainClaim.create({
    data: {
      provedDomain: best.domain,
      matchKind: strongestMatch(best.targets),
      proofKind: best.proof,
      fromAddress: address,
      fromName: displayName(message.from),
      emails: {
        create: {
          side: "PROJECT",
          messageId: message.messageId,
          subject: message.subject?.slice(0, 300) ?? null,
          bodyText: message.bodyText,
          fromAddress: address,
          toAddress: message.to?.slice(0, 300) ?? null,
          authRaw: message.authResults[0]?.slice(0, 4_000) ?? null,
          receivedAt: message.receivedAt,
        },
      },
      targets: {
        create: best.targets.map((t) => ({
          subjectKind: t.subjectKind,
          subjectId: t.subjectId,
          subjectName: t.subjectName,
          subjectDomain: t.subjectDomain,
          // Занятый объект виден, но этой дверью не передаётся.
          selected: !t.owned,
          owned: t.owned,
        })),
      },
    },
    select: { id: true },
  });

  const caseId = await ensureCase({
    subjectType: "DOMAIN_CLAIM",
    subjectId: claim.id,
    // Заголовок дела — снимок, он стоит в русском и в любом другом интерфейсе:
    // слова в нём быть не должно. Одна цель — её имя, несколько — домен и
    // число; что это за объекты, говорит раздел «Письмо с домена».
    title:
      best.targets.length === 1
        ? `${best.domain} — ${best.targets[0].subjectName}`
        : `${best.domain} — ${best.targets.length} ×`,
    // Учётной записи у отправителя письма нет, поэтому нитки заявителя у дела
    // тоже нет: переписка идёт письмами, раздел «Письма» в деле.
    applicantUserId: null,
    openedAt: message.receivedAt,
  });

  return { kind: "claimed", claimId: claim.id, caseId, targets: best.targets.length };
}
