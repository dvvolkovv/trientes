import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { companySendState, countFollowers, quotaLeft, readCabinetPromos } from "@/lib/promos/read";
import { PROMO_RECEIVES_PER_DAY, PROMO_SENDS_PER_DAY } from "@/lib/promos/antispam";
import { promoWindow } from "@/lib/promos/rules";
import { PromoList } from "@/components/promos/promo-list";
import { PromoForm } from "@/components/promos/promo-form";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Акции предприятия и рассылка подписчикам (слайс BG, ТЗ 6.5). Своей модерации у акции
 * нет — её объявляет уже залистованное предприятие, тем же правом, которым правит цену.
 * Потолки рассылок — наши, и названы на экране прямо: магазин, настраивающий себе
 * потолок, потолка не имеет.
 */
export default async function CompanyPromosPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetPromos");
  const format = await getFormatter();
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "promos")) notFound();
  const editable = canEditSection(permissions, "promos");

  const [promos, followers, sendState, points, offers] = await Promise.all([
    readCabinetPromos(company.id),
    countFollowers(company.id),
    companySendState(company.id),
    prisma.companyPoint.findMany({
      where: { companyId: company.id, status: "APPROVED", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true },
    }),
    prisma.productOffer.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { productId: true, product: { select: { name: true } } },
    }),
  ]);

  // Привязывать можно только то, что человек видит: точка вне участка в списке не
  // появляется (правило BE), иначе он завёл бы акцию-невидимку.
  const scopedPoints = points.filter((p) => pointScopeAllows(pointScope, p.id));
  const listed = company.status === "APPROVED" && !company.suspendedAt;
  const left = quotaLeft(sendState);
  const now = new Date();

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-12 py-10">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h1>
        <p className="text-muted text-sm">{t("subtitle")}</p>
      </header>

      {!listed ? (
        <p className="text-sm text-muted border border-hairline rounded-md p-3 mb-6">{t("notListed")}</p>
      ) : null}

      <section className="border border-hairline rounded-md p-3 mb-6 text-sm">
        <p>{t("followers", { count: followers })}</p>
        <p className="text-muted mt-1">
          {t("quota", { left, perDay: PROMO_SENDS_PER_DAY, perUser: PROMO_RECEIVES_PER_DAY })}
        </p>
      </section>

      {editable ? (
        <PromoForm
          companyId={company.id}
          points={scopedPoints.map((p) => ({ id: p.id, label: [p.name, p.city].filter(Boolean).join(" · ") }))}
          products={offers.map((o) => ({ id: o.productId, label: o.product.name }))}
        />
      ) : null}

      <PromoList
        locale={locale}
        editable={editable}
        sendBlocked={!listed ? "not_listed" : left === 0 ? "daily_cap" : null}
        promos={promos.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          state: promoWindow(p, now),
          window: `${format.dateTime(p.startsAt, { day: "numeric", month: "short" })} — ${format.dateTime(p.endsAt, { day: "numeric", month: "short" })}`,
          archived: p.archivedAt !== null,
          sent: p.sentAt !== null,
          followers: p.followers,
          delivered: p.delivered,
          skipped: p.skipped,
          clicks: p.clicks,
          productSlug: p.productSlug,
        }))}
      />
    </main>
  );
}
