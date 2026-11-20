import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CompanyOffersBlock } from "@/components/company/offers-block";
import { CompanyLoyaltyLine } from "@/components/company/loyalty-line";
import { CompanyPromosBlock } from "@/components/company/promos-block";
import { FollowButton } from "@/components/company/follow-button";
import { MessageStoreButton } from "@/components/customer-messages/message-store-button";
import { auth } from "@/auth";
import { readFollow } from "@/lib/promos/read";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import { HoursTable, OpenBadge } from "@/components/business/hours-view";
import { parseWeekHours } from "@/lib/opening-hours";
import { companyMode } from "@/lib/company-mode";
import { effectiveCategory, merchantCategory } from "@/lib/merchant-categories";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { localizedProse } from "@/lib/localized-prose";
import { serializeJsonLd } from "@/lib/json-ld";
import { TranslatedBadge } from "@/components/coin-card/translated-badge";

export const dynamic = "force-dynamic";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const row = await prisma.company.findFirst({
    where: { id, ...NOT_DELETED },
    select: { displayName: true, legalName: true, description: true, logoUrl: true, country: true, city: true, status: true, kybStatus: true, suspendedAt: true },
  });
  if (!row || row.status !== "APPROVED" || row.suspendedAt) return {};
  const verifiedPrefix = row.kybStatus === "APPROVED" ? "✓ " : "";
  const title = `${verifiedPrefix}${row.displayName} — crypto-friendly business`;
  const location = [row.city, row.country].filter(Boolean).join(", ");
  const description = row.description?.slice(0, 200)
    ?? `${row.displayName}${location ? ` (${location})` : ""} accepts crypto. Verified profile on Trientes.`;
  const canonical = `${SITE}/${locale}/companies/${id}`;
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ orig?: string }>;
}) {
  const { locale, id } = await params;
  const { orig } = await searchParams;
  setRequestLocale(locale);

  const company = await prisma.company.findFirst({
    where: { id, ...NOT_DELETED },
    include: {
      points: {
        where: { status: "APPROVED", ...NOT_DELETED },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, type: true, name: true, address: true, lat: true, lon: true,
          city: true, countryCode: true, openingHours: true, website: true, photos: true,
          hours: true, timezone: true, category: true, suspendedAt: true,
        },
      },
    },
  });
  // Снятое надзором предприятие страницы не имеет: иначе снятие с витрины
  // было бы половинчатым — точки ушли, а страница осталась.
  if (!company || company.status !== "APPROVED" || company.suspendedAt) notFound();

  const t = await getTranslations("companyPublic");
  const tk = await getTranslations("business.kyb");
  // Названия видов заведения живут в `business.category.*` — один список на кабинет
  // и на витрину: второй разошёлся бы с первым.
  const tb = await getTranslations("business");
  // Подписка — согласие на рассылку (ТЗ 4.2), поэтому состояние читается на каждом
  // показе: отписавшийся не должен видеть «вы подписаны» до перезахода.
  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const follow = viewerId ? await readFollow(viewerId, company.id) : null;
  // Нитка одна на магазин (BQ § 2.2): уже начавшего разговор кнопка ведёт в него, а
  // сотруднику этого же предприятия писать себе снаружи незачем.
  const [ownThread, viewerMembership] = viewerId
    ? await Promise.all([
        prisma.customerThread.findUnique({
          where: { companyId_customerUserId: { companyId: company.id, customerUserId: viewerId } },
          select: { id: true },
        }),
        prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId: company.id, userId: viewerId } },
          select: { userId: true },
        }),
      ])
    : [null, null];
  const onlinePoints = company.points.filter((p) => p.type === "ONLINE");
  const physicalPoints = company.points.filter((p) => p.type !== "ONLINE");

  // Тип магазина (ТЗ § 3.1) выводится из фактов, а не заявляется: заявленный соврал
  // бы в тот же день, когда у предприятия сняли надзором последнюю точку.
  const onlineStockShelves = await prisma.warehouse.count({
    where: {
      companyId: company.id,
      kind: "SHELF",
      online: true,
      archivedAt: null,
      balances: { some: { qty: { gt: 0 } } },
    },
  });
  const mode = companyMode({
    offlinePoints: physicalPoints.filter((p) => p.lat !== null && p.lon !== null && !p.suspendedAt).length,
    onlinePoints: onlinePoints.length,
    onlineStockShelves,
  });
  const companyCategory = merchantCategory(company.category);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Companies", item: `${SITE}/${locale}/companies` },
      { "@type": "ListItem", position: 2, name: company.displayName, item: `${SITE}/${locale}/companies/${id}` },
    ],
  };
  const orgLd = company.kybStatus === "APPROVED" ? {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.displayName,
    legalName: company.legalName,
    url: `${SITE}/${locale}/companies/${id}`,
    logo: company.logoUrl ?? undefined,
    description: company.description ?? undefined,
    address: company.address ? { "@type": "PostalAddress", streetAddress: company.address } : undefined,
  } : null;

  // Описание компании пишет сама компания — показываем его на языке интерфейса.
  const about = await localizedProse({
    ns: "company",
    id,
    locale,
    sourceLocale: null,
    fields: { description: company.description },
    original: orig === "1",
  });

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-10">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
      />
      {orgLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(orgLd) }}
        />
      ) : null}
      <header className="flex items-start gap-4 flex-wrap">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
        ) : (
          <div className="h-16 w-16 rounded-xl bg-bg-tint" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em]">
              {company.displayName}
            </h1>
            {company.kybStatus === "APPROVED" ? (
              <span
                title={tk("status.APPROVED")}
                className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full bg-green-500/15 text-green-500"
              >
                ✓ {t("verified")}
              </span>
            ) : null}
          </div>
          <p className="text-muted">{company.legalName}</p>
          {company.country || company.city ? (
            <p className="text-sm text-muted mt-1">
              {[company.city, company.country].filter(Boolean).join(", ")}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            {companyCategory ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
                <span aria-hidden>{companyCategory.emoji}</span>
                {tb(`category.${companyCategory.key}`)}
              </span>
            ) : null}
            {mode !== "none" ? (
              <span className="inline-flex items-center rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
                {t(`mode.${mode}`)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <FollowButton
            companyId={company.id}
            locale={locale}
            following={follow !== null}
            signedIn={viewerId !== null}
          />
          <MessageStoreButton
            companyId={company.id}
            locale={locale}
            signedIn={viewerId !== null}
            threadId={ownThread?.id ?? null}
            isMember={viewerMembership !== null}
          />
        </div>
      </header>

      {about.fields.description ? (
        <section>
          <p className="whitespace-pre-wrap text-sm md:text-base">{about.fields.description}</p>
          {about.translated ? (
            <p className="mt-1">
              <TranslatedBadge originalHref={`/${locale}/companies/${id}?orig=1`} />
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="grid sm:grid-cols-2 gap-3 text-sm">
        {company.website ? (
          <Field label={t("website")}>
            <a href={company.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
              {company.website.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        ) : null}
        {company.email ? (
          <Field label={t("email")}>
            <a href={`mailto:${company.email}`} className="text-accent underline">{company.email}</a>
          </Field>
        ) : null}
        {company.phone ? <Field label={t("phone")}><span>{company.phone}</span></Field> : null}
        {company.address ? <Field label={t("address")}><span>{company.address}</span></Field> : null}
        {/* Политика возврата: ТЗ § 3.1 требует её показывать. Не указана — говорим
            это словами, а не прячем раздел. */}
        <Field label={t("returns")}>
          {company.returnPolicy || company.returnDays !== null ? (
            <span className="whitespace-pre-wrap">
              {company.returnDays !== null ? (
                <span className="num">{t("returnDays", { days: company.returnDays })}</span>
              ) : null}
              {company.returnDays !== null && company.returnPolicy ? " · " : null}
              {company.returnPolicy}
            </span>
          ) : (
            <span className="text-muted">{t("returnsUnknown")}</span>
          )}
        </Field>
      </section>

      {/* Что продавец обещает вообще (слайс BD): ставка «на всё» и лучшая категория. */}
      <CompanyLoyaltyLine companyId={company.id} />

      {/* Акции магазина (слайс BG). Текст — слово продавца, срок — его срок. */}
      <CompanyPromosBlock companyId={company.id} locale={locale} />

      {/* Витрина товаров предприятия (слайс BC): цена и ставка — его заявления. */}
      <CompanyOffersBlock companyId={company.id} locale={locale} />

      {physicalPoints.length > 0 ? (
        <section>
          <h2 className="text-[20px] font-semibold mb-3">{t("placesTitle")}</h2>
          <ul className="space-y-2">
            {physicalPoints.map((p) => {
              const photos = Array.isArray(p.photos) ? (p.photos as { url?: unknown }[]).filter((x) => typeof x?.url === "string") : [];
              return (
                <li key={p.id} className="border border-hairline rounded-md px-3 py-2.5">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{p.address ?? "—"}</div>
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{t(`pointType.${p.type}`)}</span>
                    {(() => {
                      const cat = merchantCategory(effectiveCategory(p.category, company.category));
                      return cat ? <span>{cat.emoji} {tb(`category.${cat.key}`)}</span> : null;
                    })()}
                    <OpenBadge hours={parseWeekHours(p.hours)} timezone={p.timezone} />
                    {p.lat !== null && p.lon !== null ? (
                      <Link href={`/${locale}/coin/bitcoin`} className="text-accent underline">
                        {t("openOnMap")} →
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-1.5">
                    <HoursTable
                      hours={parseWeekHours(p.hours)}
                      timezone={p.timezone}
                      fallbackText={p.openingHours}
                    />
                  </div>
                  {photos.length > 0 ? (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {photos.map((ph, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={String((ph as { url: string }).url)} alt=""
                          className="h-20 w-20 rounded-md object-cover flex-shrink-0 border border-hairline" />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {onlinePoints.length > 0 ? (
        <section>
          <h2 className="text-[20px] font-semibold mb-3">{t("onlineTitle")}</h2>
          <ul className="space-y-2">
            {onlinePoints.map((p) => (
              <li key={p.id} className="border border-hairline rounded-md px-3 py-2.5">
                <div className="font-medium">{p.name}</div>
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent underline">
                    {p.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted mb-0.5">{label}</div>
      {children}
    </div>
  );
}
