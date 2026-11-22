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
import { industry as industryOf } from "@/lib/industries";
import { logoBoxClass, logoImageClass } from "@/lib/company-logo";
import { parsePublicFields } from "@/lib/company-public-fields";
import { docRubricKey, isCompanyDocKind } from "@/lib/company-docs";
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
      // Публичные документы (слайс BU): на витрину идут только опубликованные —
      // черновик виден лишь в кабинете.
      documents: {
        where: { publishedAt: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, kindCustom: true, title: true, url: true, linkUrl: true },
      },
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
  const companyIndustry = industryOf(company.industry);
  // Что показывать (слайс BU). Умолчание точного адреса зависит от того, есть ли
  // живые физические точки: предприятие без них торгует онлайн, и его адрес часто
  // домашний.
  const show = parsePublicFields(company.publicFields, {
    hasPhysicalPoints: physicalPoints.some((p) => !p.suspendedAt),
  });
  const officeHours = parseWeekHours(company.hours);
  const publicDocs = company.documents.filter((d) => isCompanyDocKind(d.kind));
  // Группы документов: ключ один на витрину и кабинет, название своей рубрики —
  // слово продавца, название реестровой — наш перевод.
  const docGroups: {
    key: string;
    label: string;
    rows: { id: string; title: string | null; url: string | null; linkUrl: string | null }[];
  }[] = [];
  for (const d of publicDocs) {
    const key = docRubricKey(d.kind, d.kindCustom);
    const label = d.kind === "other" && d.kindCustom ? d.kindCustom : tb(`docs.kind.${d.kind}`);
    const found = docGroups.find((g) => g.key === key);
    const row = { id: d.id, title: d.title, url: d.url, linkUrl: d.linkUrl };
    if (found) found.rows.push(row);
    else docGroups.push({ key, label, rows: [row] });
  }

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
        {/* Форма, вписывание и центровка — из того же модуля, что в кабинете
            (слайс BU): предприятие выбрало круг — круг и на витрине. */}
        <div className={`${logoBoxClass(company.logoShape)} h-16 w-16 shrink-0`}>
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className={logoImageClass(company.logoFit)} />
          ) : null}
        </div>
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
            {companyIndustry ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
                <span aria-hidden>{companyIndustry.emoji}</span>
                {tb(`industryKind.${companyIndustry.key}`)}
              </span>
            ) : null}
            {company.industryCustom ? (
              <span className="inline-flex items-center rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
                {company.industryCustom}
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

      {about.fields.description && show.description ? (
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
        {company.email && show.email ? (
          <Field label={t("email")}>
            <a href={`mailto:${company.email}`} className="text-accent underline">{company.email}</a>
          </Field>
        ) : null}
        {company.phone && show.phone ? <Field label={t("phone")}><span>{company.phone}</span></Field> : null}
        {/* Точный адрес выключается, город и страна — нет: по ним предприятие
            находят, и прятать их значило бы убрать его из каталога. */}
        {company.address && show.preciseAddress ? (
          <Field label={t("address")}><span>{company.address}</span></Field>
        ) : null}
        {/* Политика возврата: ТЗ § 3.1 требует её показывать, и не указана — мы
            говорим это словами, а не прячем строку. Но выключатель продавца
            сильнее (решение владельца 22 ноября): выключено — строки нет вовсе. */}
        {show.returnPolicy ? (
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
        ) : null}
      </section>

      {company.registrationNumber || company.taxNumber ? (
        // Публичные реквизиты (слайс BV). Выключателя у них нет: публичные
        // реквизиты, которые не публичны, — противоречие в названии, а кто не хочет
        // их показывать, просто не заполняет поле. Моноширинным: номер сверяют знак
        // в знак с записью реестра.
        <section>
          <h2 className="mb-2 text-[20px] font-semibold">{t("requisitesTitle")}</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label={t("legalName")}><span>{company.legalName}</span></Field>
            {company.registrationNumber ? (
              <Field label={t("registrationNumber")}>
                <span className="font-mono text-[13px]">{company.registrationNumber}</span>
              </Field>
            ) : null}
            {company.taxNumber ? (
              <Field label={t("taxNumber")}>
                <span className="font-mono text-[13px]">{company.taxNumber}</span>
              </Field>
            ) : null}
          </div>
        </section>
      ) : null}

      {officeHours && show.hours ? (
        // Часы конторы (слайс BU): когда отвечает телефон, почта и человек. Часы
        // торговли стоят у точек ниже — расписание принадлежит месту (BN).
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold">{t("officeHoursTitle")}</h2>
            <OpenBadge hours={officeHours} timezone={company.timezone} />
          </div>
          <HoursTable hours={officeHours} timezone={company.timezone} />
          <p className="mt-1 text-[12px] text-muted">{t("officeHoursHint")}</p>
        </section>
      ) : null}

      {docGroups.length > 0 && show.documents ? (
        // Публичные документы (слайсы BU и BV): политика возврата полностью,
        // гарантия, лицензия. Это бумаги для покупателя, а не для проверяющего, и
        // стоят они рубриками — своими в том числе.
        <section>
          <h2 className="mb-2 text-[20px] font-semibold">{t("documentsTitle")}</h2>
          <div className="space-y-3">
            {docGroups.map((g) => (
              <div key={g.key}>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">{g.label}</div>
                <ul className="space-y-1.5">
                  {g.rows.map((d) => (
                    <li key={d.id}>
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-accent underline"
                        >
                          {d.title ?? g.label}
                        </a>
                      ) : (
                        <span className="text-sm">{d.title ?? g.label}</span>
                      )}
                      {/* Ссылка под документом (слайс BV): где бумагу проверить.
                          Отдельной строкой и своими словами — наш файл
                          подтверждает только то, что продавец его загрузил. */}
                      {d.linkUrl ? (
                        <a
                          href={d.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="mt-0.5 block text-[12px] text-muted underline"
                        >
                          {tb("docs.verifyLink")} ↗
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {/* Часы онлайна (слайс BU): в данных они были с BN, но редактор
                      их не показывал — у онлайн-точки расписания не бывало. */}
                  <OpenBadge hours={parseWeekHours(p.hours)} timezone={p.timezone} />
                </div>
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent underline">
                    {p.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                <div className="mt-1.5">
                  <HoursTable hours={parseWeekHours(p.hours)} timezone={p.timezone} />
                </div>
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
