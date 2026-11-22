import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCompanies } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { CreateCompanyForm } from "@/components/cabinet/create-company-form";
import { storeUnreadTotal } from "@/lib/customer-messages/read";
import { ADMIN_TILE_CENTERED } from "@/lib/admin-ui";
import { TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { logoBoxClass, logoImageClass } from "@/lib/company-logo";
import { LIVE_POINT } from "@/lib/soft-delete";

/**
 * Список предприятий в кабинете (слайс BU).
 *
 * Прежде это была лента текстовых строк: витринное имя, юридическое лицо и
 * плашка статуса. Логотип в списке не читался вовсе, хотя у предприятия он есть,
 * — а выбирая, в какое из двух предприятий войти, человек ищет глазом знак, а не
 * читает две строки.
 *
 * Своего заголовка у раздела больше нет: его ставит оболочка страницы. Прежде
 * один и тот же ключ рисовался дважды подряд.
 */
export async function CompaniesSection({ locale, cardParam }: { locale: string; cardParam?: string }) {
  const { companies } = await listViewerCompanies();
  const t = await getTranslations("cabinet.companies");
  const tb = await getTranslations("business");

  const stats = await Promise.all(
    companies.map(async (c) => {
      const [points, offers, unread] = await Promise.all([
        prisma.companyPoint.count({ where: { companyId: c.id, status: "APPROVED", ...LIVE_POINT } }),
        prisma.productOffer.count({ where: { companyId: c.id } }),
        storeUnreadTotal(c.id),
      ]);
      return { id: c.id, points, offers, unread };
    }),
  );
  const byId = new Map(stats.map((s) => [s.id, s]));

  return (
    <section id="companies" className="space-y-6">
      {companies.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <div className={TILE_GRID}>
          {companies.map((c) => {
            const s = byId.get(c.id);
            return (
              <Link
                key={c.id}
                href={`/${locale}/cabinet/companies/${c.id}`}
                className={`${ADMIN_TILE_CENTERED} transition-colors hover:border-accent/60`}
              >
                {s && s.unread > 0 ? (
                  // Значок непрочитанного нужен раньше, чем внутри предприятия:
                  // владелец двух магазинов иначе не знает, в какой заходить.
                  <span className="absolute right-2 top-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                    🔔 {s.unread}
                  </span>
                ) : null}
                <div className={`${logoBoxClass(c.logoShape)} h-12 w-12`}>
                  {c.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" className={logoImageClass(c.logoFit)} />
                  ) : (
                    <span className="text-lg" aria-hidden>🏢</span>
                  )}
                </div>
                <div className="mt-2 min-w-0 text-center">
                  <div className="truncate text-[14px] font-semibold leading-tight">{c.displayName}</div>
                  <div className="truncate text-[11px] text-muted">{c.legalName}</div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[c.status] ?? ""}`}>
                    {t(`status.${c.status}`)}
                  </span>
                  {c.kybStatus === "APPROVED" ? (
                    <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-500">
                      ✓ {tb("kyb.title")}
                    </span>
                  ) : null}
                </div>
                {s ? (
                  <div className="mt-1 text-center text-[11px] text-muted">
                    {t("tileCounts", { points: s.points, offers: s.offers })}
                  </div>
                ) : null}
                {c.status === "REJECTED" && c.rejectionReason ? (
                  <div className="mt-1 line-clamp-2 text-center text-[11px] text-red-400">{c.rejectionReason}</div>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
      <CreateCompanyForm nextCard={cardParam} />
    </section>
  );
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};
