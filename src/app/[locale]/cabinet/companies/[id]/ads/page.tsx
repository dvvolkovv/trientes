import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { canEditSection, canSeeSection, getViewerCompanyById } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { MAX_CAROUSEL_SLIDES, adSlides } from "@/lib/ads/rules";
import {
  adEditMode,
  adSlotsTaken,
  readPendingPayload,
  type AdSlotRow,
  type AdStatus,
} from "@/lib/ads/moderation";
import { AdForm, type AdFormValues } from "@/components/ads/ad-form";
import { readTop100 } from "@/lib/snapshot";
import { listSelfListedCards } from "@/lib/coin-card-directory";
import { AdList, type AdRow } from "@/components/ads/ad-list";
import { CompanyDocsSection, type DocRow } from "@/components/business/company-docs-section";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Баннер карточки: материалы предприятия (слайс BY), публикует их модератор
 * (слайс CC). Продавец заводит материал, отправляет на проверку и видит решение
 * с причиной; место в карусели занимает уже отправленный.
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
  // Занято — опубликованные **и** ждущие проверки: иначе потолок вскрылся бы в
  // момент одобрения, отказом по уже проверенному делу (слайс CC).
  // Места карусели считаются в кадрах (слайс CE), а не в материалах.
  const taken = adSlotsTaken(ads as unknown as AdSlotRow[]);
  const editing = editId ? ads.find((a) => a.id === editId) ?? null : null;
  const day = (d: Date) => format.dateTime(d, { day: "numeric", month: "short" });

  // Правит человек **свою последнюю** версию: у опубликованного материала это
  // ждущий слепок, иначе его правка исчезла бы с экрана и он набрал бы её заново.
  const proposed = editing ? readPendingPayload(editing.pendingPayload) : null;
  const shown = editing ? { ...editing, ...(proposed ?? {}) } : null;
  const initial: AdFormValues | null = editing && shown
    ? {
        id: editing.id,
        kind: shown.kind,
        title: shown.title,
        body: shown.body ?? "",
        language: shown.language,
        mediaKind: shown.mediaKind,
        mediaUrl: shown.mediaUrl,
        posterUrl: shown.posterUrl ?? "",
        slides: adSlides(shown),
        audioUrl: shown.audioUrl ?? "",
        promoCode: shown.promoCode ?? "",
        startsAt: shown.startsAt ? shown.startsAt.toISOString().slice(0, 10) : "",
        endsAt: shown.endsAt ? shown.endsAt.toISOString().slice(0, 10) : "",
        eventAt: shown.eventAt ? shown.eventAt.toISOString().slice(0, 10) : "",
        eventEndAt: shown.eventEndAt ? shown.eventEndAt.toISOString().slice(0, 10) : "",
        audioGenerated: shown.audioGenerated,
        audioVoice: shown.audioVoice ?? "",
        audioTextHash: shown.audioTextHash ?? "",
        placeName: shown.placeName ?? "",
        placeAddress: shown.placeAddress ?? "",
        placeLat: shown.placeLat,
        placeLon: shown.placeLon,
        placeAcceptedCoinIds: shown.placeAcceptedCoinIds,
        placeAcceptedCardIds: shown.placeAcceptedCardIds,
        placePaymentMethods: shown.placePaymentMethods,
        action: shown.action,
        productId: shown.productId ?? "",
        pointId: shown.pointId ?? "",
        actionUrl: shown.actionUrl ?? "",
      }
    : null;

  const liveOrder = ads.filter((a) => a.status === "PUBLISHED").map((a) => a.id);
  // Первый кадр материала в карусели: места считаются в кадрах, и «третий материал»
  // человеку ничего не говорит про то, что он увидит (слайс CE).
  const firstSlideOf = new Map<string, number>();
  {
    let used = 0;
    for (const a of ads.filter((x) => x.status === "PUBLISHED")) {
      firstSlideOf.set(a.id, used + 1);
      used += adSlides(a).length;
    }
  }
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
    hasPending: a.pendingPayload !== null && a.pendingPayload !== undefined,
    rejectionReason: a.rejectionReason,
    position: liveOrder.indexOf(a.id) >= 0 ? liveOrder.indexOf(a.id) + 1 : undefined,
    slides: adSlides(a).length,
    firstSlide: firstSlideOf.get(a.id),
  }));

  return (
    <main className="mx-auto max-w-[900px] overflow-x-clip px-4 py-10 md:px-12">
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
        <p>{t("liveCount", { count: taken, max: MAX_CAROUSEL_SLIDES })}</p>
        {/* Публикует модератор, и сказать это надо прямо: продавец ищет кнопку
            «опубликовать», которой больше нет. */}
        <p className="mt-1 text-muted">{t("moderationHint")}</p>
      </section>

      {/* Материал на проверке не правится вовсе (слайс CC): модератор смотрит
          именно это содержание. Вместо формы — слова и один выход: отозвать. */}
      {editable && editing && adEditMode(editing.status as AdStatus) === "frozen" ? (
        <p className="mb-8 rounded-md border border-accent/40 bg-accent/10 p-3 text-sm text-accent">
          {t("frozenOnReview")}
        </p>
      ) : editable ? (
        <AdForm
          companyId={company.id}
          initial={initial}
          editMode={editing ? adEditMode(editing.status as AdStatus) : "direct"}
          defaultLanguage={locale}
          points={points
            .filter((p) => pointScopeAllows(pointScope, p.id))
            .map((p) => ({ id: p.id, label: [p.name, p.city].filter(Boolean).join(" · ") }))}
          products={offers.map((o) => ({ id: o.productId, label: o.product.name }))}
          coins={coinRows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl }))}
          cards={cardRows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl }))}
          countryCode={company.countryCode}
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
