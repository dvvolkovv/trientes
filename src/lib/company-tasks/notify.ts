/**
 * Уведомления по задаче — теми же каналами, что приглашение в команду (`notifyUser`:
 * Telegram, почта, web-push) и **на языке кабинета получателя**, а не страницы автора
 * (прецедент — письмо сброса пароля и заготовки AO).
 *
 * Колокольчика в кабинете мерчанта не заводим: `AdminNotification` — таблица сотрудников
 * платформы. Сбой уведомления работу не роняет: поручение дороже письма о нём.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { pickLocale } from "@/lib/locales";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://trientes.org";

export type TaskNotifyKind = "assigned" | "submitted" | "accepted" | "returned" | "cancelled" | "commented";

export async function notifyTaskEvent(input: {
  kind: TaskNotifyKind;
  /** Кому писать. Автору своего же действия не пишем — отсев делает вызывающий. */
  userIds: readonly string[];
  companyId: string;
  companyName: string;
  taskId: string;
  taskTitle: string;
  extra?: string | null;
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
      const url = `${SITE_ORIGIN}/${locale}/cabinet/companies/${input.companyId}/tasks/${input.taskId}`;
      const vars = { title: input.taskTitle, company: input.companyName };
      const subject = await rawMessage(locale, `notify.task.${input.kind}.subject`, vars);
      const body = await rawMessage(locale, `notify.task.${input.kind}.body`, vars);
      await notifyUser({
        userId: user.id,
        subject,
        text: [body, input.extra ?? "", url].filter(Boolean).join("\n\n"),
        url,
      });
    }
  } catch (error) {
    console.error("task_notify_failed", input.taskId, input.kind, error);
  }
}
