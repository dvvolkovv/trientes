import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ADMIN_BUTTON } from "@/lib/admin-ui";

/**
 * Ожидающие заявки со старых экранов убраны: решение, принятое здесь, прошло бы
 * мимо листа проверок, мимо переписки и мимо второй подписи. Две двери к одному
 * решению означают, что правила четырёх глаз нет. Остальное (история решений,
 * владение карточками, удалённые записи) на этих экранах осталось.
 */
export async function QueueMoved({ locale, queue }: { locale: string; queue: string }) {
  const t = await getTranslations("admin.movedToQueues");
  return (
    <div className="mb-6 rounded-[20px] border border-hairline bg-card p-5 text-center">
      <b className="mb-1.5 block text-[15px] font-semibold">{t("title")}</b>
      <p className="mx-auto mb-4 max-w-[520px] text-[12.5px] leading-snug text-muted">
        {t("body")}
      </p>
      <Link href={`/${locale}/admin/queues/${queue}`} className={`${ADMIN_BUTTON} mx-auto max-w-[320px]`}>
        {t("cta")}
      </Link>
    </div>
  );
}
