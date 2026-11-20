"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { logCompanyAction } from "@/lib/company-team/journal";
import { notifyChatMention } from "@/lib/company-chat/notify";
import { readChatMembers, readChatSince, type ChatRow } from "@/lib/company-chat/read";
import { canWithdraw, chatRightsFor, parseMentions, unreadFrom, validateMessage } from "@/lib/company-chat/rules";

/**
 * Общий чат команды (слайс BP). Раздела прав у комнаты нет: читают и пишут все члены,
 * включая наблюдателя (спека § 2.2). Отзыв чужого сообщения — акт управления и ложится
 * в журнал предприятия; отзыв своего в журнал не пишется.
 */

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function touch(companyId: string) {
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/chat`, "page");
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/g/order`, "page");
}

/** Пометить комнату прочитанной. Личная строка на человека, а не на сторону (§ 2.3). */
async function markRead(companyId: string, userId: string) {
  const now = new Date();
  await prisma.companyChatRead.upsert({
    where: { companyId_userId: { companyId, userId } },
    update: { lastReadAt: now },
    create: { companyId, userId, lastReadAt: now },
  });
}

export async function markChatRead(companyId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!chatRightsFor(gate).read) return fail("forbidden");
  await markRead(companyId, userId);
  return { ok: true as const };
}

export async function postChatMessage(companyId: string, body: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  const rights = chatRightsFor(gate);
  if (!rights.read) return fail("forbidden");
  // Снятое надзором или удалённое предприятие разговор не продолжает (§ 2.8).
  if (!rights.post) return fail("company_inactive");

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayCount = await prisma.companyChatMessage.count({
    where: { companyId, createdAt: { gte: startOfDay } },
  });
  const check = validateMessage(body, { todayCount });
  if (!check.ok) return fail(check.reason);

  const members = await readChatMembers(companyId);
  const mentions = parseMentions(body, members, userId);
  const text = body.trim();

  const message = await prisma.companyChatMessage.create({
    data: { companyId, authorUserId: userId, body: text, mentions },
    select: { id: true },
  });
  // Написавший свою комнату прочёл: иначе значок зажигался бы от своих же слов.
  await markRead(companyId, userId);

  if (mentions.length > 0) {
    const me = members.find((m) => m.userId === userId);
    await notifyChatMention({
      userIds: mentions,
      companyId,
      companyName: gate!.displayName,
      authorLabel: me?.label ?? "",
      body: text,
    });
  }

  touch(companyId);
  return { ok: true as const, id: message.id };
}

export async function withdrawChatMessage(companyId: string, messageId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!chatRightsFor(gate).read) return fail("forbidden");

  const message = await prisma.companyChatMessage.findFirst({
    where: { id: messageId, companyId },
    select: { id: true, authorUserId: true, deletedAt: true, body: true },
  });
  if (!message) return fail("not_found");
  const isOwner = gate!.role === "OWNER";
  if (!canWithdraw(message, { userId, isOwner })) return fail("forbidden");

  // Условный `updateMany` по `deletedAt: null` — два одновременных отзыва не перепишут
  // автора отзыва дважды (приём ссылки сброса пароля и приглашений в команду).
  const done = await prisma.companyChatMessage.updateMany({
    where: { id: messageId, companyId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: userId },
  });
  if (done.count === 0) return fail("not_found");

  // Свои слова человек убирает молча; чужие — под запись: журнал ТЗ 6.6 про то, «кто,
  // что и когда», и снятое чужое сообщение этим вопросом и является.
  if (message.authorUserId !== userId) {
    await logCompanyAction({
      companyId,
      actorUserId: userId,
      action: "CHAT_MESSAGE_DELETED",
      subject: message.body.slice(0, 80),
    });
  }

  touch(companyId);
  return { ok: true as const };
}

/**
 * Опрос новых сообщений открытой страницей. Вебсокетов в проекте нет ни одного, и
 * заводить их ради комнаты из трёх человек несоразмерно; невидимая вкладка не стучит
 * вовсе (§ 2.6). Прочитанным помечаем только когда пришло чужое: молчащий опрос в базу
 * не пишет.
 */
export async function pollChat(
  companyId: string,
  afterId: string | null,
): Promise<{ ok: true; rows: ChatRow[] } | Fail> {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!chatRightsFor(gate).read) return fail("forbidden");

  const rows = await readChatSince(companyId, { userId }, afterId);
  // Правило «что считается непрочитанным» одно и то же для значка на плитке и для
  // опроса: чужое и неотозванное. Поэтому считает чистая `unreadFrom`, а не второе
  // условие в этом файле, которое разошлось бы с первым.
  const fresh = unreadFrom(
    rows.map((r) => ({
      authorUserId: r.author?.id ?? null,
      createdAt: r.createdAt,
      deletedAt: r.withdrawn ? r.createdAt : null,
    })),
    { userId, lastReadAt: null },
  );
  if (fresh > 0) await markRead(companyId, userId);
  return { ok: true, rows };
}
