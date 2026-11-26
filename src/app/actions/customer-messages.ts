"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { emitCompanyEvent } from "@/lib/automation/emit";
import { editorCompany } from "@/lib/products/editor-company";
import { can } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import {
  customerRepliers,
  notifyCustomerOfStoreReply,
  notifyStoreOfCustomerMessage,
} from "@/lib/customer-messages/notify";
import { customerLoad, readThreadSince, type CustomerMessageRow } from "@/lib/customer-messages/read";
import {
  canWithdrawCustomerMessage,
  companyAcceptsMessages,
  notifiesStaff,
  unreadForSide,
  validateBlock,
  validateCustomerMessage,
  validateStoreReply,
  type CustomerSideKey,
} from "@/lib/customer-messages/rules";

/**
 * Переписка покупателя с магазином (слайс BQ) — первая дверь снаружи внутрь кабинета
 * мерчанта. Спека `docs/superpowers/specs/2026-11-20-customer-messages-design.md`.
 *
 * Покупателя охраняет антиспам (§ 2.6) и блокировка магазина, сотрудника — девятый
 * раздел прав `customers`: говорить от имени магазина вправе не каждый член команды.
 */

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function touchStore(companyId: string, threadId?: string) {
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/inbox`, "page");
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/g/showcase`, "page");
  if (threadId) revalidatePath(`/[locale]/cabinet/companies/${companyId}/inbox/${threadId}`, "page");
}

function touchCustomer(threadId: string) {
  revalidatePath(`/[locale]/cabinet/messages`, "page");
  revalidatePath(`/[locale]/cabinet/messages/${threadId}`, "page");
}

async function markRead(threadId: string, side: CustomerSideKey) {
  const now = new Date();
  await prisma.customerThread.update({
    where: { id: threadId },
    data: side === "STORE" ? { storeReadAt: now } : { customerReadAt: now },
  });
}

/** Нитка покупателя: она одна на магазин (§ 2.2), поэтому ищется, а не создаётся заново. */
async function customerThread(threadId: string, userId: string) {
  return prisma.customerThread.findFirst({
    where: { id: threadId, customerUserId: userId },
    select: {
      id: true,
      companyId: true,
      blockedAt: true,
      company: { select: { status: true, suspendedAt: true, deletedAt: true, displayName: true } },
    },
  });
}

/**
 * Написать магазину с его карточки. Нитка завязывается здесь же: кнопка снаружи ведёт
 * в разговор, а не в форму «создать обращение».
 */
export async function messageStore(companyId: string, body: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, status: true, suspendedAt: true, deletedAt: true, displayName: true },
  });
  // Дверь снаружи есть только у видимого на витрине предприятия (§ 2.9). Карточка
  // снятого отдаёт 404, но серверное действие зовут и прямым запросом.
  if (!companyAcceptsMessages(company)) return fail("company_inactive");

  // Сотрудник предприятия не пишет своему же магазину снаружи: это тот же человек с
  // двух сторон, и нитка «магазин ↔ он сам» ничего не значит.
  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { userId: true },
  });
  if (member) return fail("own_company");

  const thread = await prisma.customerThread.findUnique({
    where: { companyId_customerUserId: { companyId, customerUserId: userId } },
    select: { id: true, blockedAt: true, storeReadAt: true },
  });

  const load = await customerLoad(userId, thread?.id ?? null);
  const check = validateCustomerMessage(body, {
    blocked: Boolean(thread?.blockedAt),
    companyActive: true,
    todayCount: load.todayCount,
    unansweredCount: load.unanswered,
  });
  if (!check.ok) return fail(check.reason);

  const text = body.trim();
  const now = new Date();

  // Непрочитанное магазина **до** записи: по нему решается, уходит ли письмо смене
  // (§ 2.8) — иначе собственное сообщение считалось бы началом разговора всегда.
  let storeUnreadBefore = 0;
  if (thread) {
    const rows = await prisma.customerMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { side: true, createdAt: true, deletedAt: true },
    });
    storeUnreadBefore = unreadForSide(rows as { side: CustomerSideKey; createdAt: Date; deletedAt: Date | null }[], "STORE", thread.storeReadAt);
  }

  const threadId = thread
    ? thread.id
    : (
        await prisma.customerThread.create({
          data: { companyId, customerUserId: userId, lastMessageAt: now },
          select: { id: true },
        })
      ).id;

  await prisma.$transaction([
    prisma.customerMessage.create({
      data: { threadId, side: "CUSTOMER", authorUserId: userId, body: text },
    }),
    // Написавший своё прочёл: иначе значок зажигался бы от своих же слов.
    prisma.customerThread.update({
      where: { id: threadId },
      data: { lastMessageAt: now, customerReadAt: now },
    }),
  ]);

  if (notifiesStaff({ storeUnreadBefore })) {
    const staff = await customerRepliers(companyId);
    await notifyStoreOfCustomerMessage({
      userIds: staff,
      companyId,
      companyName: company!.displayName,
      threadId,
      body: text,
    });
  }

  // Событие автоматизации (CO). «Начало разговора» — то же число, которым решается,
  // уходит ли письмо смене: второго правила «первое ли это сообщение» не заводим.
  // Наружу человек виден `@именем-входа` (решение BT), им он назван и внутри события.
  const who = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  const username = who?.username ?? null;
  await emitCompanyEvent({
    companyId,
    kind: "CUSTOMER_MESSAGE",
    subject: username ? `@${username}` : null,
    actorUserId: userId,
    data: {
      threadId,
      customerName: username ? `@${username}` : null,
      firstMessage: notifiesStaff({ storeUnreadBefore }),
    },
  });

  touchStore(companyId, threadId);
  touchCustomer(threadId);
  return { ok: true as const, threadId };
}

/** Ответ магазина. Право `customers: EDIT` — говорить от имени магазина вправе не каждый. */
export async function replyAsStore(companyId: string, threadId: string, body: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!gate || !can(gate.permissions, "customers", "EDIT")) return fail("forbidden");

  const thread = await prisma.customerThread.findFirst({
    where: { id: threadId, companyId },
    select: { id: true, customerUserId: true },
  });
  if (!thread) return fail("not_found");

  const check = validateStoreReply(body, {
    companyActive: !gate.suspendedAt && !gate.deletedAt && gate.status === "APPROVED",
  });
  if (!check.ok) return fail(check.reason);

  const text = body.trim();
  const now = new Date();
  await prisma.$transaction([
    prisma.customerMessage.create({
      data: { threadId, side: "STORE", authorUserId: userId, body: text },
    }),
    prisma.customerThread.update({
      where: { id: threadId },
      data: { lastMessageAt: now, storeReadAt: now },
    }),
  ]);

  await notifyCustomerOfStoreReply({
    userId: thread.customerUserId,
    companyName: gate.displayName,
    threadId,
    body: text,
  });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "CUSTOMER_REPLIED",
    subject: text.slice(0, 80),
  });

  touchStore(companyId, threadId);
  touchCustomer(threadId);
  return { ok: true as const };
}

/** Продолжение разговора покупателем: та же проверка, что у первого сообщения. */
export async function replyAsCustomer(threadId: string, body: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const thread = await customerThread(threadId, userId);
  if (!thread) return fail("not_found");
  const result = await messageStore(thread.companyId, body);
  return result;
}

export async function markThreadRead(threadId: string, side: CustomerSideKey) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (side === "CUSTOMER") {
    const thread = await customerThread(threadId, userId);
    if (!thread) return fail("not_found");
    await markRead(threadId, "CUSTOMER");
    return { ok: true as const };
  }
  const thread = await prisma.customerThread.findUnique({
    where: { id: threadId },
    select: { companyId: true },
  });
  if (!thread) return fail("not_found");
  const gate = await editorCompany(thread.companyId, userId);
  if (!gate || !can(gate.permissions, "customers", "VIEW")) return fail("forbidden");
  await markRead(threadId, "STORE");
  return { ok: true as const };
}

/**
 * Блокировка покупателя магазином (§ 2.7). Нитка остаётся читаемой обеим сторонам;
 * причина видна только своим — блокировка это конец разговора, а не его продолжение.
 */
export async function setCustomerBlocked(
  companyId: string,
  threadId: string,
  blocked: boolean,
  reason?: string | null,
) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!gate || !can(gate.permissions, "customers", "EDIT")) return fail("forbidden");

  const thread = await prisma.customerThread.findFirst({
    where: { id: threadId, companyId },
    select: { id: true, customer: { select: { username: true, name: true, email: true, id: true } } },
  });
  if (!thread) return fail("not_found");

  const check = validateBlock(blocked ? reason ?? null : null);
  if (!check.ok) return fail(check.reason);

  await prisma.customerThread.update({
    where: { id: threadId },
    data: blocked
      ? { blockedAt: new Date(), blockedById: userId, blockReason: reason?.trim() || null }
      : { blockedAt: null, blockedById: null, blockReason: null },
  });

  const who =
    thread.customer.username || thread.customer.name || thread.customer.email || thread.customer.id.slice(0, 8);
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: blocked ? "CUSTOMER_BLOCKED" : "CUSTOMER_UNBLOCKED",
    subject: who,
  });

  touchStore(companyId, threadId);
  touchCustomer(threadId);
  return { ok: true as const };
}

/**
 * Отзыв сообщения. Своё отзывает автор, слово магазина — ещё и владелец; слова
 * покупателя магазин не отзывает (§ 2.10) — против потока у него есть блокировка.
 */
export async function withdrawCustomerMessage(threadId: string, messageId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");

  const message = await prisma.customerMessage.findFirst({
    where: { id: messageId, threadId },
    select: {
      id: true,
      side: true,
      authorUserId: true,
      deletedAt: true,
      body: true,
      thread: { select: { companyId: true, customerUserId: true, blockedAt: true } },
    },
  });
  if (!message) return fail("not_found");

  const isCustomer = message.thread.customerUserId === userId;
  let viewerSide: CustomerSideKey | null = isCustomer ? "CUSTOMER" : null;
  let isOwner = false;
  let companyName = "";
  if (!viewerSide) {
    const gate = await editorCompany(message.thread.companyId, userId);
    if (!gate || !can(gate.permissions, "customers", "EDIT")) return fail("forbidden");
    viewerSide = "STORE";
    isOwner = gate.role === "OWNER";
    companyName = gate.displayName;
  }
  if (
    !canWithdrawCustomerMessage(message, {
      userId,
      side: viewerSide,
      isOwner,
      threadBlocked: Boolean(message.thread.blockedAt),
    })
  ) {
    return fail("forbidden");
  }

  // Условный `updateMany` по `deletedAt: null`: два одновременных отзыва не перепишут
  // автора отзыва дважды (приём ссылки сброса пароля).
  const done = await prisma.customerMessage.updateMany({
    where: { id: messageId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: userId },
  });
  if (done.count === 0) return fail("not_found");

  // Чужие слова магазина убирает владелец — это акт управления, и он ложится в журнал.
  if (viewerSide === "STORE" && message.authorUserId !== userId) {
    await logCompanyAction({
      companyId: message.thread.companyId,
      actorUserId: userId,
      action: "CUSTOMER_MESSAGE_DELETED",
      subject: message.body.slice(0, 80),
    });
  }
  void companyName;

  touchStore(message.thread.companyId, threadId);
  touchCustomer(threadId);
  return { ok: true as const };
}

/**
 * Опрос новых строк открытой страницей — раз в 15 с и только пока вкладка видна
 * (приём BP). Прочитанным помечаем лишь когда пришло чужое: молчащий опрос в базу
 * не пишет.
 */
export async function pollThread(
  threadId: string,
  side: CustomerSideKey,
  after: string | null,
): Promise<{ ok: true; rows: CustomerMessageRow[] } | Fail> {
  const userId = await requireUser();
  if (!userId) return fail("unauth");

  if (side === "CUSTOMER") {
    const thread = await customerThread(threadId, userId);
    if (!thread) return fail("not_found");
  } else {
    const thread = await prisma.customerThread.findUnique({
      where: { id: threadId },
      select: { companyId: true },
    });
    if (!thread) return fail("not_found");
    const gate = await editorCompany(thread.companyId, userId);
    if (!gate || !can(gate.permissions, "customers", "VIEW")) return fail("forbidden");
  }

  const since = after ? new Date(after) : new Date(Date.now() - 60_000);
  const rows = await readThreadSince(threadId, side, since);
  const fresh = rows.filter((r) => !r.mine && !r.withdrawn).length;
  if (fresh > 0) await markRead(threadId, side);
  return { ok: true, rows };
}
