/**
 * Уведомление об упоминании в чате команды — теми же каналами, что уведомления по
 * задаче (`notifyUser`: Telegram → почта → web-push) и **на языке кабинета получателя**.
 *
 * Уходит **только по упоминанию** (спека § 2.4): письмо на каждую фразу общего чата —
 * это спам, которым мы портим домен, с которого пишем настоящим заявителям. Обычное
 * сообщение даёт только значок с числом на плитке.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { pickLocale } from "@/lib/locales";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://trientes.org";

/** Сколько слов сообщения уходит в уведомление: остальное человек прочтёт в комнате. */
const EXCERPT = 300;

export async function notifyChatMention(input: {
  userIds: readonly string[];
  companyId: string;
  companyName: string;
  authorLabel: string;
  body: string;
}): Promise<void> {
  const targets = [...new Set(input.userIds.filter(Boolean))];
  if (targets.length === 0) return;
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: targets } },
      select: { id: true, preferredLocale: true },
    });
    const excerpt = input.body.length > EXCERPT ? `${input.body.slice(0, EXCERPT)}…` : input.body;
    for (const user of users) {
      const locale = pickLocale(user.preferredLocale);
      const url = `${SITE_ORIGIN}/${locale}/cabinet/companies/${input.companyId}/chat`;
      const vars = { author: input.authorLabel, company: input.companyName };
      const subject = await rawMessage(locale, "notify.chat.mention.subject", vars);
      const body = await rawMessage(locale, "notify.chat.mention.body", vars);
      await notifyUser({ userId: user.id, subject, text: [body, excerpt, url].join("\n\n"), url });
    }
  } catch (error) {
    // Сбой уведомления разговор не роняет: сказанное дороже письма о сказанном.
    console.error("chat_mention_notify_failed", input.companyId, error);
  }
}
