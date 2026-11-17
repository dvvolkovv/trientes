import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { pickLocale } from "@/lib/locales";
import { rawMessage } from "@/lib/messages-raw";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Письмо и Telegram — на языке кабинета заявителя, а не страницы сотрудника:
 * тот же довод, что у письма сброса пароля.
 *
 * Строки читаются `rawMessage`, а не `getTranslations`: тот ходит через
 * `requestLocale` и вне запроса падает, а зовут эту функцию и серверные экшены,
 * и ежедневный прогон жалоб в воркере. Живой прогон 17 ноября это и поймал:
 * сообщение в нитке появлялось, а владелец о нём не узнавал.
 *
 * Сбой уведомления сообщение не отменяет: оно уже в нитке, человек увидит его
 * в кабинете. Поэтому — console.error и ничего больше.
 */
export async function notifyApplicantOfMessage(input: {
  applicantUserId: string;
  caseId: string;
  caseTitle: string;
  preview: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.applicantUserId },
      select: { preferredLocale: true },
    });
    const locale = pickLocale(user?.preferredLocale);
    const vars = { title: input.caseTitle };
    const url = `${SITE_ORIGIN}/${locale}/cabinet/cases/${input.caseId}`;
    const body = await rawMessage(locale, "notify.caseMessage.body", vars);
    const subject = await rawMessage(locale, "notify.caseMessage.subject", vars);
    await notifyUser({
      userId: input.applicantUserId,
      subject,
      text: [body, input.preview, url].join("\n\n"),
      url,
    });
  } catch (err) {
    console.error("[case-notify] applicant notification failed", { caseId: input.caseId, err });
  }
}
