import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { ADMIN_COLUMN, ADMIN_TILE, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { can } from "@/lib/company-team/permissions";
import { readCompanyCustomer, readCustomerSales, readCustomerThreadId } from "@/lib/crm/read";
import { customerLabel, segmentsFor } from "@/lib/crm/segments";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Карточка покупателя (слайс CN, ТЗ 6.8 «Аналитика клиента»): признаки, история покупок
 * **в этом магазине** и оборот. Чужая покупка не его дело, а почты и телефона тут нет
 * вовсе: наружу человек виден `@именем-входа` (решение BT), и продавцу этого достаточно.
 */
export default async function CompanyCustomerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; userId: string }>;
}) {
  const { locale, id, userId: customerId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetCrm");
  const format = await getFormatter();
  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!can(permissions, "customers", "VIEW")) notFound();
  const showMoney = can(permissions, "sales", "VIEW") || can(permissions, "reports", "VIEW");
  const canOpenSale = can(permissions, "sales", "VIEW");

  const now = new Date();
  const facts = await readCompanyCustomer(company.id, customerId, now);
  // Человек, которого этот магазин не знает, его покупателем не является: 404, а не
  // пустая карточка — пустая читалась бы как «он у нас есть, но ничего не покупал».
  if (!facts) notFound();

  const [sales, threadId] = await Promise.all([
    readCustomerSales(company.id, customerId),
    readCustomerThreadId(company.id, customerId),
  ]);

  const base = `/${locale}/cabinet/companies/${company.id}`;
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={`${base}/customers`} className="text-[12px] text-muted underline">
          ← {t("title")}
        </Link>
        <h1 className="num mt-2 text-[26px] font-bold tracking-[-0.03em]">{customerLabel(facts)}</h1>
        <div className="mt-2 flex flex-wrap gap-1">
          {segmentsFor(facts, now).map((s) => (
            <span key={s} className="rounded-full bg-accent/10 px-2 py-[2px] text-[11px] text-accent">
              {t(`segment.${s}`)}
            </span>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className={ADMIN_TILE}>
          <div className="text-[11px] text-muted">{t("card.purchases")}</div>
          <div className="num mt-1 text-[22px] font-bold">{facts.purchases}</div>
          {facts.cancelled > 0 ? (
            <div className="mt-1 text-[11px] text-muted">{t("card.cancelled", { count: facts.cancelled })}</div>
          ) : null}
        </div>
        <div className={ADMIN_TILE}>
          <div className="text-[11px] text-muted">{t("card.first")}</div>
          <div className="mt-1 text-sm">
            {facts.firstPurchaseAt ? format.dateTime(facts.firstPurchaseAt, { dateStyle: "medium" }) : "—"}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {facts.lastPurchaseAt
              ? t("lastPurchase", { date: format.dateTime(facts.lastPurchaseAt, { dateStyle: "short" }) })
              : t("noPurchase")}
          </div>
        </div>
        <div className={ADMIN_TILE}>
          <div className="text-[11px] text-muted">{t("card.subscription")}</div>
          <div className="mt-1 text-sm">
            {facts.follows ? (facts.muted ? t("card.mutedYes") : t("card.followYes")) : t("card.followNo")}
          </div>
          {facts.follows && !facts.notifyPromos ? (
            <div className="mt-1 text-[11px] text-muted">{t("card.promosOff")}</div>
          ) : null}
        </div>
      </section>

      {showMoney ? (
        <section className="rounded-[14px] border border-hairline bg-card p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t("card.turnover")}</h2>
          {Object.keys(facts.turnover).length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("card.noTurnover")}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(facts.turnover).map(([currency, sum]) => (
                <li key={currency} className="num">
                  {money(sum, currency)}
                  <span className="text-muted">
                    {" · "}
                    {t("card.cashbackCounted", { amount: money(facts.cashback[currency] ?? 0, currency) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* Кэшбэк посчитан, но не начислен: кошелька платформы нет (решение BD). */}
          <p className="mt-2 text-[11px] text-muted">{t("card.cashbackNote")}</p>
        </section>
      ) : (
        <p className="text-[11px] text-muted">{t("card.moneyHidden")}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t("card.history")}</h2>
        {sales.length === 0 ? (
          <p className="rounded-[14px] border border-hairline bg-card p-4 text-sm text-muted">{t("card.noHistory")}</p>
        ) : (
          <ul className="space-y-2">
            {sales.map((s) => {
              const row = (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="num text-sm font-semibold">
                      № {s.number}
                      {s.status === "CANCELLED" ? ` · ${t("card.cancelledBadge")}` : ""}
                    </span>
                    <span className="text-[11px] text-muted">
                      {format.dateTime(s.createdAt, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {s.lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}
                    {s.pointName ? ` · ${s.pointName}` : ""}
                  </div>
                  {showMoney ? (
                    <div className="num mt-1 text-sm">{money(s.total, s.currency)}</div>
                  ) : null}
                  {s.status === "CANCELLED" && s.cancelReason ? (
                    <div className="mt-1 text-[11px] text-muted">{s.cancelReason}</div>
                  ) : null}
                </>
              );
              return (
                <li key={s.id}>
                  {canOpenSale ? (
                    <Link href={`${base}/sales/${s.id}`} className={`${ADMIN_TILE} block`}>
                      {row}
                    </Link>
                  ) : (
                    <div className={ADMIN_TILE}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {threadId ? (
        <Link href={`${base}/inbox/${threadId}`} className={ADMIN_BUTTON_SECONDARY}>
          {t("card.openThread")}
        </Link>
      ) : null}

      <p className="text-[11px] text-muted">{t("privacy")}</p>
    </main>
  );
}
