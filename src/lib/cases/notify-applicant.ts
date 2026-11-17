import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { pickLocale } from "@/lib/locales";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Письмо и Telegram — на языке кабинета заявителя, а не страницы сотрудника:
 * тот же довод, что у письма сброса пароля.
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
    const t = await getTranslations({ locale, namespace: "notify.caseMessage" });
    const url = `${SITE_ORIGIN}/${locale}/cabinet/cases/${input.caseId}`;
    const text = [t("body", { title: input.caseTitle }), input.preview, url].join("\n\n");
    await notifyUser({
      userId: input.applicantUserId,
      subject: t("subject", { title: input.caseTitle }),
      text,
      url,
    });
  } catch (err) {
    console.error("[case-notify] applicant notification failed", { caseId: input.caseId, err });
  }
}
