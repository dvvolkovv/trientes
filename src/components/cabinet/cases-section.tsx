import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { unreadCount } from "@/lib/cases/messages";

/**
 * «Ваши заявки» — вход в переписку со стороны заявителя.
 *
 * Права намеренно узкие: нитку видит тот, кто подал (`applicantUserId`).
 * Сотрудник компании-редактор переписку владельца не читает — расширять это
 * будем, когда появится явное требование.
 */
export async function CasesSection({ locale, userId }: { locale: string; userId: string }) {
  const t = await getTranslations("cabinet.cases");

  const cases = await prisma.complianceCase.findMany({
    where: { applicantUserId: userId },
    orderBy: { updatedAt: "desc" },
    take: 25,
    include: {
      messages: { select: { side: true, readByStaffAt: true, readByApplicantAt: true } },
    },
  });
  if (cases.length === 0) return null;

  return (
    <section id="cases" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      <p className="text-muted">{t("subtitle")}</p>
      <ul className="flex flex-col gap-3">
        {cases.map((c) => {
          const unread = unreadCount(c.messages, "APPLICANT");
          return (
            <li key={c.id}>
              <Link
                href={`/${locale}/cabinet/cases/${c.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-[16px] border border-hairline bg-card p-4 transition-colors hover:border-accent/60"
              >
                <span>
                  <b className="block text-[14px] font-semibold leading-tight">{c.title}</b>
                  <span className="text-[11.5px] text-muted">{t(`status.${c.status}`)}</span>
                </span>
                {unread > 0 ? (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-foreground">
                    {t("unread", { count: unread })}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
