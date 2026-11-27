"use server";

/**
 * Приём платежей в карточке магазина (слайс CP). Единственная дверь к номеру ссылки.
 *
 * Второй двери нет и не будет: ни админка, ни модератор, ни массовый импорт, ни ключ
 * API номер ссылки не меняют (задание, § 2.7) — это право, которым меняется получатель
 * денег, и настройке ролями оно не подлежит тоже.
 *
 * Каждое действие записи проверяет четыре вещи в этом порядке: вошёл, владелец этого
 * предприятия, токен против подделки запроса, правило `planPayLinkChange`. Проверки
 * **на сервере**, а не скрытием кнопки: серверное действие вызывается прямым запросом
 * (дыра, которую живой прогон BA нашёл у `startMfaEnrollment`).
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkCsrf } from "@/lib/csrf";
import { clientIp } from "@/lib/client-ip";
import { currentFreshLoginAt } from "@/lib/session-fresh";
import { parsePayLinkInput } from "@/lib/pay-link/parse";
import { fetchPayLink, type PayLinkInfo } from "@/lib/pay-link/service";
import { codeUsable, CODE_TTL_MS, newPairingCode, titleHasCode } from "@/lib/pay-link/code";
import { checkLinkRateLimit, recordLinkCheck } from "@/lib/pay-link/limits";
import { planPayLinkChange, type PayLinkPlan } from "@/lib/pay-link/rules";
import { readChannels } from "@/lib/pay-link/channels";
import {
  cancelPending,
  deletePayLink,
  notifyOwners,
  readPayLinkState,
  schedulePayLink,
  writePayLink,
  type ActorFacts,
} from "@/lib/pay-link/store";
import { NOT_DELETED } from "@/lib/soft-delete";

export type PayLinkFail = { ok: false; reason: string };
export type PayLinkPreview = {
  ok: true;
  /** Что показать владельцу перед сохранением (§ 2.4). */
  linkId: string;
  merchant: string;
  merchantId: string;
  title: string;
  amount: string | null;
  unit: string;
  coinSymbol: string | null;
  /** Что случится при «да»: сразу, через сутки или отказ с причиной. */
  plan: PayLinkPlan["kind"] | "deny";
  denyReason?: string;
  effectiveAt?: string;
};

/**
 * Кто перед нами: владелец **этого** предприятия и ничего меньше.
 *
 * Не `canWrite(gate, "card")`: правом на карточку наделяют сотрудника, а сменить
 * получателя денег вправе только владелец — как команда, KYB и удаление предприятия
 * (решение BE). Снятое надзором и удалённое предприятие ссылку не правит.
 */
async function requireOwnerOf(companyId: string): Promise<
  { ok: true; userId: string; companyId: string } | PayLinkFail
> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { ok: false, reason: "unauth" };
  const [company, member] = await Promise.all([
    prisma.company.findFirst({
      where: { id: companyId, ...NOT_DELETED },
      select: { id: true, suspendedAt: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true },
    }),
  ]);
  if (!company || !member || member.role !== "OWNER") return { ok: false, reason: "not_found" };
  if (company.suspendedAt) return { ok: false, reason: "suspended" };
  return { ok: true, userId, companyId: company.id };
}

async function actorFacts(userId: string): Promise<ActorFacts> {
  const h = await headers();
  return {
    userId,
    ip: clientIp(new Request("https://trientes.org", { headers: h })),
    userAgent: h.get("user-agent"),
  };
}

/**
 * Выдать одноразовый код для названия ссылки (§ 2.3). Прежние невостребованные коды
 * гасятся: просьба о новом коде отменяет прежнюю (прецедент — ссылка сброса пароля).
 */
export async function issuePayLinkCode(
  companyId: string,
  csrf: string,
): Promise<{ ok: true; code: string; expiresAt: string } | PayLinkFail> {
  const me = await requireOwnerOf(companyId);
  if (!me.ok) return me;
  if (!(await checkCsrf(csrf))) return { ok: false, reason: "csrf" };
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.companyPayLinkCode.updateMany({
    where: { companyId, userId: me.userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.companyPayLinkCode.create({
    data: { companyId, userId: me.userId, code, expiresAt },
  });
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

/** Живой код этого человека для этой карточки; `null` — надо выдать новый. */
async function liveCode(companyId: string, userId: string, now: Date) {
  const row = await prisma.companyPayLinkCode.findFirst({
    where: { companyId, userId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return codeUsable(row, now) ? row : null;
}

/**
 * Спросить службу о ссылке и сказать владельцу, что получится. Ничего не сохраняет:
 * непроверенное в базу не ложится, а проверенное сохраняет только `savePayLink`, и он
 * спрашивает службу **заново** — браузеру на подтверждении не верим (§ 2.4).
 */
export async function checkPayLink(
  companyId: string,
  raw: string,
  csrf: string,
): Promise<PayLinkPreview | PayLinkFail> {
  const me = await requireOwnerOf(companyId);
  if (!me.ok) return me;
  if (!(await checkCsrf(csrf))) return { ok: false, reason: "csrf" };

  const parsed = parsePayLinkInput(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const facts = await actorFacts(me.userId);
  const ip = facts.ip ?? "unknown";
  // Потолок считается **до** запроса наружу: отказ не должен стоить чужой службе
  // вызова, а расход пишется до работы (приём BC) — иначе перебор был бы бесплатным.
  const limit = await checkLinkRateLimit(ip, me.userId);
  if (limit.blocked) return { ok: false, reason: "too_many_checks" };
  await recordLinkCheck(ip, me.userId);

  const outcome = await fetchPayLink(parsed.linkId);
  if (outcome.kind === "missing") return { ok: false, reason: "link_missing" };
  if (outcome.kind === "off") return { ok: false, reason: "link_off" };
  if (outcome.kind === "later") return { ok: false, reason: "link_later" };

  const plan = await planFor(companyId, me.userId, parsed.linkId, outcome.info);
  return {
    ok: true,
    linkId: parsed.linkId,
    merchant: outcome.info.merchant,
    merchantId: outcome.info.merchantId,
    title: outcome.info.title,
    amount: outcome.info.amount,
    unit: outcome.info.unit,
    coinSymbol: outcome.info.coinSymbol,
    plan: plan.kind,
    denyReason: plan.kind === "deny" ? plan.reason : undefined,
    effectiveAt: plan.kind === "delayed" ? plan.effectiveAt.toISOString() : undefined,
  };
}

/** Решение правила по живым фактам: свежесть входа, заморозка, каналы, код. */
async function planFor(
  companyId: string,
  userId: string,
  linkId: string,
  info: PayLinkInfo,
): Promise<PayLinkPlan> {
  const now = new Date();
  const [state, user, channels, freshLoginAt, code] = await Promise.all([
    readPayLinkState(companyId),
    prisma.user.findUnique({ where: { id: userId }, select: { contactChangedAt: true } }),
    readChannels(userId),
    currentFreshLoginAt(),
    liveCode(companyId, userId, now),
  ]);
  return planPayLinkChange({
    current: state.link ? { linkId: state.link.linkId, merchantId: state.link.merchantId } : null,
    next: { linkId, merchantId: info.merchantId },
    now,
    freshLoginAt,
    contactChangedAt: user?.contactChangedAt ?? null,
    hasTelegram: channels.chatId !== null,
    hasEmail: channels.email !== null,
    codeOk: code !== null && titleHasCode(info.rawTitle, code.code),
  });
}

/**
 * Сохранить. Служба спрашивается **заново**: имени и названию, которые прислал
 * браузер, веры нет — он мог показать владельцу одно, а послать другое.
 */
export async function savePayLink(
  companyId: string,
  raw: string,
  csrf: string,
): Promise<
  | { ok: true; applied: true }
  | { ok: true; applied: false; effectiveAt: string }
  | PayLinkFail
> {
  const me = await requireOwnerOf(companyId);
  if (!me.ok) return me;
  if (!(await checkCsrf(csrf))) return { ok: false, reason: "csrf" };

  const parsed = parsePayLinkInput(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const facts = await actorFacts(me.userId);
  const ip = facts.ip ?? "unknown";
  const limit = await checkLinkRateLimit(ip, me.userId);
  if (limit.blocked) return { ok: false, reason: "too_many_checks" };
  await recordLinkCheck(ip, me.userId);

  const outcome = await fetchPayLink(parsed.linkId);
  if (outcome.kind === "missing") return { ok: false, reason: "link_missing" };
  if (outcome.kind === "off") return { ok: false, reason: "link_off" };
  if (outcome.kind === "later") return { ok: false, reason: "link_later" };

  const now = new Date();
  const [state, user, channels, freshLoginAt, code] = await Promise.all([
    readPayLinkState(companyId),
    prisma.user.findUnique({ where: { id: me.userId }, select: { contactChangedAt: true } }),
    readChannels(me.userId),
    currentFreshLoginAt(),
    liveCode(companyId, me.userId, now),
  ]);
  const codeOk = code !== null && titleHasCode(outcome.info.rawTitle, code.code);
  const plan = planPayLinkChange({
    current: state.link ? { linkId: state.link.linkId, merchantId: state.link.merchantId } : null,
    next: { linkId: parsed.linkId, merchantId: outcome.info.merchantId },
    now,
    freshLoginAt,
    contactChangedAt: user?.contactChangedAt ?? null,
    hasTelegram: channels.chatId !== null,
    hasEmail: channels.email !== null,
    codeOk,
  });
  if (plan.kind === "deny") return { ok: false, reason: plan.reason };

  // Код одноразовый и гасится **при успешном сохранении**, а не при проверке: иначе
  // владелец, упёршийся в чужой отказ, остался бы без кода и ждал бы новый.
  if (code !== null && codeOk) {
    await prisma.companyPayLinkCode.updateMany({
      where: { id: code.id, usedAt: null },
      data: { usedAt: now },
    });
  }

  if (plan.kind === "delayed") {
    await schedulePayLink({
      companyId,
      linkId: parsed.linkId,
      info: outcome.info,
      effectiveAt: plan.effectiveAt,
      actor: facts,
      before: {
        linkId: state.link!.linkId,
        merchantId: state.link!.merchantId,
        merchantName: state.link!.merchantName,
      },
    });
    revalidatePath("/", "layout");
    return { ok: true, applied: false, effectiveAt: plan.effectiveAt.toISOString() };
  }

  await writePayLink({
    companyId,
    linkId: parsed.linkId,
    info: outcome.info,
    actor: facts,
    before: state.link ? { linkId: state.link.linkId, merchantId: state.link.merchantId } : null,
    now,
  });
  // Сообщение владельцу обязательно и при первой установке, и при ссылке того же
  // магазина: тихая смена получателя денег — это и есть то, чего мы боимся.
  await notifyOwners(companyId, plan.kind === "install" ? "installed" : "sameMerchant", {
    merchant: outcome.info.merchant,
    merchantId: outcome.info.merchantId,
  });
  revalidatePath("/", "layout");
  return { ok: true, applied: true };
}

/** «Отменить» из сообщения: постоянный адрес страницы, вход обязателен (§ 2.6). */
export async function cancelPayLinkChange(
  companyId: string,
  csrf: string,
): Promise<{ ok: true } | PayLinkFail> {
  const me = await requireOwnerOf(companyId);
  if (!me.ok) return me;
  if (!(await checkCsrf(csrf))) return { ok: false, reason: "csrf" };
  const done = await cancelPending({ companyId, actor: await actorFacts(me.userId) });
  if (!done) return { ok: false, reason: "no_pending" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Убрать ссылку из карточки. Идёт сразу и без кода: удаление денег не уводит — оно их
 * останавливает. Оно же отменяет ожидающую смену.
 */
export async function removePayLink(
  companyId: string,
  csrf: string,
): Promise<{ ok: true } | PayLinkFail> {
  const me = await requireOwnerOf(companyId);
  if (!me.ok) return me;
  if (!(await checkCsrf(csrf))) return { ok: false, reason: "csrf" };
  const done = await deletePayLink({ companyId, actor: await actorFacts(me.userId) });
  if (!done) return { ok: false, reason: "no_link" };
  revalidatePath("/", "layout");
  return { ok: true };
}
