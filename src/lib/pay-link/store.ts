/**
 * Записи о ссылке оплаты: чтение состояния, журнал смен и вести владельцу.
 *
 * Правило «что сделать» живёт в `rules.ts` и проверяется тестом; здесь только работа с
 * базой и отправка. Журнал (`CompanyPayLinkChange`) пишется **всегда и первым делом**:
 * поддержке надо знать, куда шли платежи, и строка о смене дороже самой смены.
 */
import { prisma } from "@/lib/prisma";
import { rawMessage } from "@/lib/messages-raw";
import type { PayLinkInfo } from "@/lib/pay-link/service";
import { readChannels, sendToChannels, parseChannels, type PayChannels } from "@/lib/pay-link/channels";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/** Постоянный адрес страницы приёма платежей: без токенов, вход обязателен. */
export const payPageUrl = (locale: string, companyId: string): string =>
  `${SITE}/${locale}/cabinet/companies/${companyId}/payments`;

export type PayLinkChangeAction =
  | "SET"
  | "SCHEDULED"
  | "APPLIED"
  | "CANCELLED"
  | "REMOVED"
  | "DISABLED"
  | "HIDDEN";

export type ActorFacts = { userId: string | null; ip: string | null; userAgent: string | null };

/** Строка журнала смен. Сбой записи работу не роняет, но молчать о нём нельзя. */
export async function logPayChange(input: {
  companyId: string;
  action: PayLinkChangeAction;
  before?: { linkId: string; merchantId: string } | null;
  after?: { linkId: string; merchantId: string } | null;
  note?: string | null;
  actor?: ActorFacts;
}): Promise<void> {
  try {
    await prisma.companyPayLinkChange.create({
      data: {
        companyId: input.companyId,
        action: input.action,
        beforeLinkId: input.before?.linkId ?? null,
        beforeMerchantId: input.before?.merchantId ?? null,
        afterLinkId: input.after?.linkId ?? null,
        afterMerchantId: input.after?.merchantId ?? null,
        note: input.note ?? null,
        actorUserId: input.actor?.userId ?? null,
        ip: input.actor?.ip ?? null,
        userAgent: input.actor?.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (error) {
    console.error("pay_link_change_log_failed", input.companyId, input.action, error);
  }
}

/** Владельцы предприятия — им уходят вести о ссылке. */
export async function ownerIds(companyId: string): Promise<string[]> {
  const rows = await prisma.companyMember.findMany({
    where: { companyId, role: "OWNER" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Весть владельцам на их нынешние каналы и на языке их кабинетов. Для отложенной смены
 * это **не** годится — там нужен снимок каналов момента запроса (см. `channels.ts`).
 */
export async function notifyOwners(
  companyId: string,
  key: string,
  vars: Record<string, string> = {},
): Promise<void> {
  const ids = await ownerIds(companyId);
  for (const userId of ids) {
    const channels = await readChannels(userId);
    if (channels.chatId === null && channels.email === null) continue;
    await sendMessage(channels, key, { ...vars, link: payPageUrl(channels.locale, companyId) });
  }
}

/** Одна весть по снимку каналов: заголовок и тело из переводов языка получателя. */
export async function sendMessage(
  channels: PayChannels,
  key: string,
  vars: Record<string, string> = {},
): Promise<void> {
  const [subject, text] = await Promise.all([
    rawMessage(channels.locale, `payLink.notify.${key}.subject`, vars),
    rawMessage(channels.locale, `payLink.notify.${key}.body`, vars),
  ]);
  await sendToChannels(channels, { subject, text });
}

export type StoredLink = {
  linkId: string;
  merchantId: string;
  merchantName: string;
  title: string | null;
  unit: string;
  coinSymbol: string | null;
  amount: string | null;
  checkedAt: Date;
  disabledAt: Date | null;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  installedById: string | null;
};

export type StoredPending = {
  linkId: string;
  merchantId: string;
  merchantName: string;
  title: string | null;
  effectiveAt: Date;
  requestedAt: Date;
};

export type PayLinkState = { link: StoredLink | null; pending: StoredPending | null };

export async function readPayLinkState(companyId: string): Promise<PayLinkState> {
  const [link, pending] = await Promise.all([
    prisma.companyPayLink.findUnique({ where: { companyId } }),
    prisma.companyPayLinkPending.findUnique({ where: { companyId } }),
  ]);
  return { link, pending };
}

/** Поля ссылки из ответа службы. Тексты уже очищены разбором (`parseLinkPayload`). */
function linkFields(linkId: string, info: PayLinkInfo, now: Date) {
  return {
    linkId,
    merchantId: info.merchantId,
    merchantName: info.merchant,
    title: info.title === "" ? null : info.title,
    unit: info.unit,
    coinSymbol: info.coinSymbol,
    amount: info.amount,
    checkedAt: now,
    // Новая ссылка приходит проверенной: прежние пометки надзора к ней не относятся.
    disabledAt: null,
    hiddenAt: null,
    hiddenReason: null,
  };
}

/** Поставить ссылку сейчас: первая установка или ссылка того же магазина. */
export async function writePayLink(input: {
  companyId: string;
  linkId: string;
  info: PayLinkInfo;
  actor: ActorFacts;
  before: { linkId: string; merchantId: string } | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const fields = linkFields(input.linkId, input.info, now);
  await prisma.$transaction([
    prisma.companyPayLink.upsert({
      where: { companyId: input.companyId },
      create: { companyId: input.companyId, ...fields, installedById: input.actor.userId },
      update: { ...fields, installedById: input.actor.userId },
    }),
    // Ожидающая смена снимается: человек только что сказал, чего он хочет.
    prisma.companyPayLinkPending.deleteMany({ where: { companyId: input.companyId } }),
  ]);
  await logPayChange({
    companyId: input.companyId,
    action: "SET",
    before: input.before,
    after: { linkId: input.linkId, merchantId: input.info.merchantId },
    actor: input.actor,
  });
}

/** Отложить смену на другой магазин: старая ссылка работает всё это время. */
export async function schedulePayLink(input: {
  companyId: string;
  linkId: string;
  info: PayLinkInfo;
  effectiveAt: Date;
  actor: ActorFacts;
  /** Что стоит сейчас — вместе с именем: весть владельцу называет оба магазина. */
  before: { linkId: string; merchantId: string; merchantName: string };
}): Promise<void> {
  const channels = input.actor.userId ? await readChannels(input.actor.userId) : null;
  const data = {
    linkId: input.linkId,
    merchantId: input.info.merchantId,
    merchantName: input.info.merchant,
    title: input.info.title === "" ? null : input.info.title,
    unit: input.info.unit,
    coinSymbol: input.info.coinSymbol,
    amount: input.info.amount,
    requestedById: input.actor.userId,
    requestedAt: new Date(),
    effectiveAt: input.effectiveAt,
    notifyChannels: (channels ?? undefined) as never,
  };
  // Ожидающая смена одна: новый запрос заменяет прежний и отсчитывает срок заново.
  await prisma.companyPayLinkPending.upsert({
    where: { companyId: input.companyId },
    create: { companyId: input.companyId, ...data },
    update: data,
  });
  await logPayChange({
    companyId: input.companyId,
    action: "SCHEDULED",
    before: input.before,
    after: { linkId: input.linkId, merchantId: input.info.merchantId },
    actor: input.actor,
  });
  await notifyOwners(input.companyId, "scheduled", {
    was: `${input.before.merchantName} (${input.before.merchantId})`,
    willBe: input.info.merchant,
    merchantId: input.info.merchantId,
    when: input.effectiveAt.toISOString().slice(0, 16).replace("T", " "),
  });
}

/** Снять ожидающую смену: нажатием владельца или потому, что ссылка уже не годна. */
export async function cancelPending(input: {
  companyId: string;
  actor: ActorFacts;
  note?: string | null;
  notifyKey?: string;
}): Promise<boolean> {
  const pending = await prisma.companyPayLinkPending.findUnique({ where: { companyId: input.companyId } });
  if (!pending) return false;
  await prisma.companyPayLinkPending.delete({ where: { companyId: input.companyId } });
  await logPayChange({
    companyId: input.companyId,
    action: "CANCELLED",
    after: { linkId: pending.linkId, merchantId: pending.merchantId },
    note: input.note ?? null,
    actor: input.actor,
  });
  // Весть об отмене идёт на каналы момента запроса — те же, что о самой смене.
  await sendMessage(parseChannels(pending.notifyChannels), input.notifyKey ?? "cancelled", {
    merchant: pending.merchantName,
    link: payPageUrl(parseChannels(pending.notifyChannels).locale, input.companyId),
  });
  return true;
}

/** Убрать ссылку. Удаление денег не уводит, поэтому идёт сразу и без кода. */
export async function deletePayLink(input: {
  companyId: string;
  actor: ActorFacts;
}): Promise<boolean> {
  const link = await prisma.companyPayLink.findUnique({ where: { companyId: input.companyId } });
  await prisma.companyPayLinkPending.deleteMany({ where: { companyId: input.companyId } });
  if (!link) return false;
  await prisma.companyPayLink.delete({ where: { companyId: input.companyId } });
  await logPayChange({
    companyId: input.companyId,
    action: "REMOVED",
    before: { linkId: link.linkId, merchantId: link.merchantId },
    actor: input.actor,
  });
  await notifyOwners(input.companyId, "removed", { merchant: link.merchantName });
  return true;
}

/**
 * Сброс ссылки, когда поставивший её человек перестал быть владельцем предприятия.
 *
 * Передачи предприятия одним действием в проекте нет вовсе, поэтому правило задания
 * «передача карточки другому владельцу сбрасывает ссылку» привязано к тому, что
 * действительно бывает: установивший ссылку снят из команды или понижен. Сообщение
 * уходит обоим — и ему, и оставшимся владельцам.
 */
export async function resetPayLinkOnOwnerLoss(input: {
  companyId: string;
  leavingUserId: string;
  actor: ActorFacts;
}): Promise<boolean> {
  const link = await prisma.companyPayLink.findUnique({ where: { companyId: input.companyId } });
  if (!link || link.installedById !== input.leavingUserId) return false;
  await prisma.companyPayLinkPending.deleteMany({ where: { companyId: input.companyId } });
  await prisma.companyPayLink.delete({ where: { companyId: input.companyId } });
  await logPayChange({
    companyId: input.companyId,
    action: "REMOVED",
    before: { linkId: link.linkId, merchantId: link.merchantId },
    note: "owner_changed",
    actor: input.actor,
  });
  const leaving = await readChannels(input.leavingUserId);
  if (leaving.chatId || leaving.email) {
    await sendMessage(leaving, "reset", {
      merchant: link.merchantName,
      link: payPageUrl(leaving.locale, input.companyId),
    });
  }
  await notifyOwners(input.companyId, "reset", { merchant: link.merchantName });
  return true;
}
