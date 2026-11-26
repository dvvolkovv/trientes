/**
 * Уведомление от правила (слайс CO) — теми же каналами, что приглашение в команду
 * (`notifyUser`: Telegram, почта, web-push) и **на языке кабинета получателя**, а не
 * автора правила (прецедент — письмо сброса пароля и заготовки AO).
 *
 * Колокольчика в кабинете мерчанта нет: `AdminNotification` — таблица сотрудников
 * платформы (решение BF). Сбой уведомления работу не роняет.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { pickLocale } from "@/lib/locales";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://trientes.org";

export async function notifyRuleRecipients(input: {
  userIds: readonly string[];
  companyId: string;
  companyName: string;
  ruleName: string;
  /** Текст человека с уже подставленными словами события. */
  text: string;
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
      const url = `${SITE_ORIGIN}/${locale}/cabinet/companies/${input.companyId}/automation`;
      const subject = await rawMessage(locale, "notify.automation.subject", {
        company: input.companyName,
        rule: input.ruleName,
      });
      await notifyUser({ userId: user.id, subject, text: [input.text, url].join("\n\n"), url });
    }
  } catch (error) {
    console.error("automation_notify_failed", input.companyId, input.ruleName, error);
  }
}
