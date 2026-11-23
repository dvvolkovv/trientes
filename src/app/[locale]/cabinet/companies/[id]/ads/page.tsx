import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { canEditSection, canSeeSection, getViewerCompanyById } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { MAX_PUBLISHED_ADS } from "@/lib/ads/rules";
import { AdForm, type AdFormValues } from "@/components/ads/ad-form";
import { readTop100 } from "@/lib/snapshot";
import { listSelfListedCards } from "@/lib/coin-card-directory";
import { AdList, type AdRow } from "@/components/ads/ad-list";
import { CompanyDocsSection, type DocRow } from "@/components/business/company-docs-section";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Баннер карточки: материалы предприятия (слайс BY). Своей модерации у рекламы нет —
 * её объявляет уже залистованное предприятие тем же правом `promos`, которым правит
 * акции, а злоупотребление ловится жалобой и надзором.
 */
export default async function CompanyAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ad?: string }>;
}) {
  const { locale, id } = await params;
  const { ad: editId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetAds");
  const format = await getFormatter();

  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "promos")) notFound();
  const editable = canEditSection(permissions, "promos");

  const [ads, points, offers, coinRows, cardRows, adDocs] = await Promise.all([
    prisma.companyAd.findMany({
      where: { companyId: company.id },
      orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
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
    // Монеты для места материала — тот же каталог, что в форме точки (BZ).
    readTop100(),
    listSelfListedCards(200),
    // Бумаги правимого материала (слайс CB): форма и рубрики те же, что у бумаг
    // предприятия, — таблица одна, и экран один.
    editId
      ? prisma.companyDocument.findMany({
          where: { adId: editId, companyId: company.id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const listed = company.status === "APPROVED" && !company.suspendedAt;
  const live = ads.filter((a) => a.status === "PUBLISHED").length;
  const editing = editId ? ads.find((a) => a.id === editId) ?? null : null;
  const day = (d: Date) => format.dateTime(d, { day: "numeric", month: "short" });

  const initial: AdFormValues | null = editing
    ? {
        id: editing.id,
        kind: editing.kind,
        title: editing.title,
        body: editing.body ?? "",
        language: editing.language,
        mediaKind: editing.mediaKind,
        mediaUrl: editing.mediaUrl,
        posterUrl: editing.posterUrl ?? "",
        audioUrl: editing.audioUrl ?? "",
        promoCode: editing.promoCode ?? "",
        startsAt: editing.startsAt ? editing.startsAt.toISOString().slice(0, 10) : "",
        endsAt: editing.endsAt ? editing.endsAt.toISOString().slice(0, 10) : "",
        eventAt: editing.eventAt ? editing.eventAt.toISOString().slice(0, 10) : "",
        eventEndAt: editing.eventEndAt ? editing.eventEndAt.toISOString().slice(0, 10) : "",
        audioGenerated: editing.audioGenerated,
        audioVoice: editing.audioVoice ?? "",
        audioTextHash: editing.audioTextHash ?? "",
        placeName: editing.placeName ?? "",
        placeAddress: editing.placeAddress ?? "",
        placeLat: editing.placeLat,
        placeLon: editing.placeLon,
        placeAcceptedCoinIds: editing.placeAcceptedCoinIds,
        placeAcceptedCardIds: editing.placeAcceptedCardIds,
        placePaymentMethods: editing.placePaymentMethods,
        action: editing.action,
        productId: editing.productId ?? "",
        pointId: editing.pointId ?? "",
        actionUrl: editing.actionUrl ?? "",
      }
    : null;

  const liveOrder = ads.filter((a) => a.status === "PUBLISHED").map((a) => a.id);
  const rows: AdRow[] = ads.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    status: a.status,
    mediaKind: a.mediaKind,
    preview: a.mediaKind === "VIDEO" ? (a.posterUrl ?? a.mediaUrl) : a.mediaUrl,
    window:
      a.startsAt || a.endsAt
        ? `${a.startsAt ? day(a.startsAt) : "…"} — ${a.endsAt ? day(a.endsAt) : "…"}`
        : null,
    hasAudio: a.audioUrl !== null,
    position: liveOrder.indexOf(a.id) >= 0 ? liveOrder.indexOf(a.id) + 1 : undefined,
  }));

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10 md:px-12">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-6 text-xs text-muted">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="mb-1 text-[28px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </header>

      {!listed ? (
        <p className="mb-6 rounded-md border border-hairline p-3 text-sm text-muted">{t("notListed")}</p>
      ) : null}

      <section className="mb-6 rounded-md border border-hairline p-3 text-sm">
        <p>{t("liveCount", { count: live, max: MAX_PUBLISHED_ADS })}</p>
        <p className="mt-1 text-muted">{t("hint")}</p>
      </section>

      {editable ? (
        <AdForm
          companyId={company.id}
          initial={initial}
          defaultLanguage={locale}
          points={points
            .filter((p) => pointScopeAllows(pointScope, p.id))
            .map((p) => ({ id: p.id, label: [p.name, p.city].filter(Boolean).join(" · ") }))}
          products={offers.map((o) => ({ id: o.productId, label: o.product.name }))}
          coins={coinRows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl }))}
          cards={cardRows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl }))}
        />
      ) : null}

      {/* Бумаги этого объявления: разрешения и лицензии под то, что сказано на
          баннере. Заводятся только у сохранённого материала — документу нужен тот,
          к кому он прикреплён. */}
      {editable && editing ? (
        <div className="mb-8">
          <CompanyDocsSection
            companyId={company.id}
            adId={editing.id}
            canEdit
            heading={t("docsTitle")}
            subheading={t("docsSubtitle")}
            docs={adDocs.map((d): DocRow => ({
              id: d.id,
              kind: d.kind,
              kindCustom: d.kindCustom,
              title: d.title,
              url: d.url,
              linkUrl: d.linkUrl,
              published: d.publishedAt !== null,
            }))}
          />
        </div>
      ) : null}

      <AdList
        ads={rows}
        editable={editable}
        basePath={`/${locale}/cabinet/companies/${company.id}/ads`}
        adBasePath={`/${locale}/ad`}
      />
    </main>
  );
}
