/**
 * Уведомления по заказу — теми же каналами, что приглашение в команду и события задач
 * (`notifyUser`: Telegram, почта, web-push) и **на языке кабинета получателя**, а не
 * страницы автора (прецедент — письмо сброса пароля).
 *
 * Колокольчика у мерчанта нет: `AdminNotification` — таблица сотрудников платформы.
 * Сбой уведомления работу не роняет: заказ дороже письма о нём.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { pickLocale } from "@/lib/locales";
import { can, parsePermissions, permissionsFor } from "@/lib/company-team/permissions";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://trientes.org";

export type SupplyNotifyKind = "sent" | "confirmed" | "declined" | "shipped" | "autodraft";

/**
 * Кому в предприятии писать о заказе: тем, кто вправе его вести. Право читается из базы
 * на каждом вызове — снятое право перестаёт звать тем же часом.
 */
export async function supplyManagers(companyId: string): Promise<string[]> {
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    select: {
      userId: true,
      role: true,
      teamRole: { select: { permissions: true } },
    },
  });
  return members
    .filter((m) =>
      can(
        permissionsFor({
          role: m.role,
          rolePermissions: m.teamRole ? parsePermissions(m.teamRole.permissions) : null,
        }),
        "supply",
        "EDIT",
      ),
    )
    .map((m) => m.userId);
}

export async function notifySupplyEvent(input: {
  kind: SupplyNotifyKind;
  /** Кому писать. Автору своего действия не пишем — отсев делает вызывающий. */
  userIds: readonly string[];
  /** Предприятие, в чьём кабинете откроется заказ. */
  companyId: string;
  companyName: string;
  orderId: string;
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
      const url = `${SITE_ORIGIN}/${locale}/cabinet/companies/${input.companyId}/supply/${input.orderId}`;
      const vars = { company: input.companyName };
      const subject = await rawMessage(locale, `notify.supply.${input.kind}.subject`, vars);
      const body = await rawMessage(locale, `notify.supply.${input.kind}.body`, vars);
      await notifyUser({
        userId: user.id,
        subject,
        text: [body, input.extra ?? "", url].filter(Boolean).join("\n\n"),
        url,
      });
    }
  } catch (error) {
    console.error("supply_notify_failed", input.orderId, input.kind, error);
  }
}
