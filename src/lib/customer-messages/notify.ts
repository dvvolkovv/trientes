/**
 * Уведомления о переписке с покупателем — теми же каналами, что задачи и чат
 * (`notifyUser`: Telegram → почта → web-push) и **на языке кабинета получателя**.
 *
 * Покупателю пишем на каждый ответ магазина: ответа ждут. Сотрудникам — только на
 * **начало разговора** (`notifiesStaff`): письмо на каждую фразу это спам, которым мы
 * портим домен, с которого пишем настоящим заявителям (правило BG и BP).
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { pickLocale } from "@/lib/locales";
import { can, parsePermissions, permissionsFor } from "@/lib/company-team/permissions";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://trientes.org";

/** Сколько слов сообщения уходит в уведомление: остальное человек прочтёт в нитке. */
const EXCERPT = 300;

function excerpt(body: string): string {
  return body.length > EXCERPT ? `${body.slice(0, EXCERPT)}…` : body;
}

/**
 * Кому в предприятии писать о сообщении покупателя: тем, кто вправе отвечать. Право
 * читается из базы на каждом вызове — снятое перестаёт звать тем же часом (приём BI).
 */
export async function customerRepliers(companyId: string): Promise<string[]> {
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    select: { userId: true, role: true, teamRole: { select: { permissions: true } } },
  });
  return members
    .filter((m) =>
      can(
        permissionsFor({
          role: m.role,
          rolePermissions: m.teamRole ? parsePermissions(m.teamRole.permissions) : null,
        }),
        "customers",
        "EDIT",
      ),
    )
    .map((m) => m.userId);
}

export async function notifyStoreOfCustomerMessage(input: {
  userIds: readonly string[];
  companyId: string;
  companyName: string;
  threadId: string;
  body: string;
}): Promise<void> {
  const targets = [...new Set(input.userIds.filter(Boolean))];
  if (targets.length === 0) return;
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: targets } },
      select: { id: true, preferredLocale: true },
    });
    for (const user of users) {
      const locale = pickLocale(user.preferredLocale);
      const url = `${SITE_ORIGIN}/${locale}/cabinet/companies/${input.companyId}/inbox/${input.threadId}`;
      const vars = { company: input.companyName };
      const subject = await rawMessage(locale, "notify.customerMessage.toStore.subject", vars);
      const body = await rawMessage(locale, "notify.customerMessage.toStore.body", vars);
      await notifyUser({ userId: user.id, subject, text: [body, excerpt(input.body), url].join("\n\n"), url });
    }
  } catch (error) {
    console.error("customer_message_notify_failed", input.threadId, error);
  }
}

export async function notifyCustomerOfStoreReply(input: {
  userId: string;
  companyName: string;
  threadId: string;
  body: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, preferredLocale: true },
    });
    if (!user) return;
    const locale = pickLocale(user.preferredLocale);
    const url = `${SITE_ORIGIN}/${locale}/cabinet/messages/${input.threadId}`;
    const vars = { company: input.companyName };
    const subject = await rawMessage(locale, "notify.customerMessage.toCustomer.subject", vars);
    const body = await rawMessage(locale, "notify.customerMessage.toCustomer.body", vars);
    await notifyUser({ userId: user.id, subject, text: [body, excerpt(input.body), url].join("\n\n"), url });
  } catch (error) {
    console.error("store_reply_notify_failed", input.threadId, error);
  }
}
