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
import { inheritedHours, showsPointHoursTable } from "@/lib/company-inherit";
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
import { VISIBLE_PRODUCT } from "@/lib/products/read";
import { CARD_ACTION, CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";

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
  // Часы точки: своё сильнее, пустое означает «как у предприятия» (слайс BX).
  // Та же функция, что читает фид карты, — иначе витрина и карта разошлись бы.
  const pointHours = (p: { hours: unknown; timezone: string | null }) =>
    inheritedHours({ hours: p.hours, timezone: p.timezone }, { hours: company.hours, timezone: company.timezone });
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

  // Куда ведёт «на карте»: живая точка с координатами. Карта без точки открылась
  // бы неизвестно где, а снятая надзором точка на ней всё равно не стоит.
  const mapPoint =
    physicalPoints.find((p) => p.lat !== null && p.lon !== null && !p.suspendedAt) ?? null;
  // «Позвонить» — то же действие, что набрать номер руками, поэтому номер идёт в
  // ссылку как есть, без пробелов и скобок: их `tel:` не понимает.
  const telHref = company.phone ? `tel:${company.phone.replace(/[^\d+]/g, "")}` : null;
  // Кнопка «витрина» показывается только когда витрине есть что показать: кнопка,
  // ведущая в пустой раздел, — обманка, а обманка хуже отказа (правило BI).
  const offerCount = show.products
    ? await prisma.productOffer.count({
        where: { companyId: company.id, status: "ACTIVE", product: { ...VISIBLE_PRODUCT } },
      })
    : 0;
  // Часы предприятия стоят своим разделом выше. Значит у точки, которая их
  // наследует, второй такой же таблицы быть не должно: именно её владелец и
  // увидел глазом — «два раза показывает время работы, одно и то же».
  const officeHoursShown = Boolean(officeHours && show.hours);

  return (
    <main className="mx-auto w-full max-w-[760px] space-y-4 px-4 py-8 md:px-6 md:py-12">
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

      {/* Шапка карточки: знак, имя, лицо, место, виды — всё колонкой по центру
          (просьба владельца 22.11). Прежде знак стоял слева, кнопки справа, и на
          телефоне ряд переносился так, что имя оказывалось между ними. */}
      <article className="overflow-hidden rounded-[22px] border border-hairline bg-card">
        <header className="flex flex-col items-center gap-2 border-b border-hairline bg-card-alt/30 px-5 py-8 text-center">
          {/* Форма, вписывание и центровка — из того же модуля, что в кабинете
              (слайс BU): предприятие выбрало круг — круг и на витрине. */}
          <div className={`${logoBoxClass(company.logoShape)} h-20 w-20 shrink-0`}>
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="" className={logoImageClass(company.logoFit)} />
            ) : (
              <span className="text-2xl" aria-hidden>🏢</span>
            )}
          </div>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] md:text-[32px]">
            {company.displayName}
          </h1>
          {company.kybStatus === "APPROVED" ? (
            <span
              title={tk("status.APPROVED")}
              className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-1 text-[12px] font-medium text-green-500"
            >
              ✓ {t("verified")}
            </span>
          ) : null}
          {company.legalName ? <p className="text-sm text-muted">{company.legalName}</p> : null}
          {company.country || company.city ? (
            <p className="text-sm text-muted">
              {[company.city, company.country].filter(Boolean).join(", ")}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[12px]">
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
            {officeHoursShown ? <OpenBadge hours={officeHours} timezone={company.timezone} /> : null}
          </div>
        </header>

        {/* Действия: всё, что человек может сделать с этим предприятием, одним
            рядом и сразу под шапкой. Выключатель продавца сильнее кнопки: скрытый
            телефон кнопки «позвонить» не даёт — иначе выключатель обходился бы
            набором номера из `tel:`. */}
        <div className="grid gap-2 px-5 py-5 sm:grid-cols-2">
          <MessageStoreButton
            companyId={company.id}
            locale={locale}
            signedIn={viewerId !== null}
            threadId={ownThread?.id ?? null}
            isMember={viewerMembership !== null}
          />
          {telHref && show.phone ? (
            <a href={telHref} className={CARD_ACTION}>
              <span aria-hidden>📞</span>
              {t("call")}
            </a>
          ) : null}
          {offerCount > 0 ? (
            <a href="#products" className={CARD_ACTION}>
              <span aria-hidden>🛍</span>
              {t("showcaseAction")}
            </a>
          ) : null}
          {mapPoint ? (
            <Link href={`/${locale}/crypto-map?point=${mapPoint.id}`} className={CARD_ACTION}>
              <span aria-hidden>📍</span>
              {t("openOnMap")}
            </Link>
          ) : null}
          {company.website && show.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={CARD_ACTION}
            >
              <span aria-hidden>🔗</span>
              {t("website")}
            </a>
          ) : null}
          <FollowButton
            companyId={company.id}
            locale={locale}
            following={follow !== null}
            signedIn={viewerId !== null}
          />
        </div>
      </article>

      {/* Реквизиты сразу под шапкой — просьба владельца: «снизу, получается, его
          реквизиты, как обычно мы с тобой моделировали карточку». Выключателя у
          них нет (решение BV): публичные реквизиты, которые не публичны, —
          противоречие в названии. Моноширинным: номер сверяют знак в знак с
          записью реестра. */}
      {company.legalName || company.registrationNumber || company.taxNumber ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("requisitesTitle")}</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {company.legalName ? (
              <Field label={t("legalName")}><span>{company.legalName}</span></Field>
            ) : null}
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

      {about.fields.description && show.description ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("aboutTitle")}</h2>
          <p className="whitespace-pre-wrap text-sm md:text-base">{about.fields.description}</p>
          {about.translated ? (
            <p className="mt-1">
              <TranslatedBadge originalHref={`/${locale}/companies/${id}?orig=1`} />
            </p>
          ) : null}
        </section>
      ) : null}

      {(company.website && show.website) ||
      (company.email && show.email) ||
      (company.phone && show.phone) ||
      (company.address && show.preciseAddress) ||
      show.returnPolicy ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("contactsTitle")}</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {company.website && show.website ? (
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
            {company.phone && show.phone ? (
              <Field label={t("phone")}>
                <a href={telHref ?? "#"} className="text-accent underline">{company.phone}</a>
              </Field>
            ) : null}
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
          </div>
        </section>
      ) : null}

      {officeHoursShown ? (
        // Часы конторы (слайс BU): когда отвечает телефон, почта и человек. Часы
        // торговли стоят у точек ниже — расписание принадлежит месту (BN).
        <section className={CARD_PANEL}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className={`${CARD_HEADING} mb-0`}>{t("officeHoursTitle")}</h2>
            <OpenBadge hours={officeHours} timezone={company.timezone} />
          </div>
          <HoursTable hours={officeHours} timezone={company.timezone} />
          <p className="mt-2 text-[12px] text-muted">{t("officeHoursHint")}</p>
        </section>
      ) : null}

      {docGroups.length > 0 && show.documents ? (
        // Публичные документы (слайсы BU и BV): политика возврата полностью,
        // гарантия, лицензия. Это бумаги для покупателя, а не для проверяющего, и
        // стоят они рубриками — своими в том числе.
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("documentsTitle")}</h2>
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

      {/* Акции магазина (слайс BG). Текст — слово продавца, срок — его срок.
          Выключатель тот же, что гасит строку акции в карточке с карты (BX):
          один модуль не может быть выключен на карте и показан на витрине. */}
      {show.promos ? <CompanyPromosBlock companyId={company.id} locale={locale} /> : null}

      {/* Витрина товаров предприятия (слайс BC): цена и ставка — его заявления.
          Модуль `products` гасит **список товаров предприятия** — здесь и в
          карточке с карты. Строку продавца на паспорте товара он не трогает:
          уйти из «где взять» — это пауза предложения (BC), а не скрытие витрины. */}
      {show.products ? <CompanyOffersBlock companyId={company.id} locale={locale} /> : null}

      {physicalPoints.length > 0 ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("placesTitle")}</h2>
          <ul className="space-y-2">
            {physicalPoints.map((p) => {
              const photos = Array.isArray(p.photos) ? (p.photos as { url?: unknown }[]).filter((x) => typeof x?.url === "string") : [];
              const ph = pointHours(p);
              // Своих часов у точки нет и выше уже стоит та же неделя предприятия
              // — печатаем одну строку о наследовании, а не вторую таблицу.
              const ownTable = showsPointHoursTable(ph.from, officeHoursShown);
              return (
                <li key={p.id} className="rounded-[14px] border border-hairline bg-bg-tint px-3 py-2.5">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{p.address ?? "—"}</div>
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{t(`pointType.${p.type}`)}</span>
                    {(() => {
                      const cat = merchantCategory(effectiveCategory(p.category, company.category));
                      return cat ? <span>{cat.emoji} {tb(`category.${cat.key}`)}</span> : null;
                    })()}
                    {show.hours ? <OpenBadge hours={ph.hours} timezone={ph.timezone} /> : null}
                    {/* В навигатор и прямо на эту точку: `?point=<id>` открывает
                        карту на ней с раскрытой карточкой. Прежде ссылка вела на
                        `/coin/bitcoin` — страницу монеты, где карта лишь один из
                        разделов: человек нажимал «открыть на карте» и попадал в
                        биткойн, а не к своему магазину. */}
                    {p.lat !== null && p.lon !== null ? (
                      <Link href={`/${locale}/crypto-map?point=${p.id}`} className="text-accent underline">
                        {t("openOnMap")} →
                      </Link>
                    ) : null}
                  </div>
                  {show.hours ? (
                    <div className="mt-1.5">
                      {ownTable ? (
                        <HoursTable
                          hours={ph.hours}
                          timezone={ph.timezone}
                          fallbackText={p.openingHours}
                        />
                      ) : (
                        <p className="text-[11px] text-muted">{t("hoursFromCompany")}</p>
                      )}
                    </div>
                  ) : null}
                  {photos.length > 0 && show.photos ? (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {photos.map((ph2, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={String((ph2 as { url: string }).url)} alt=""
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
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("onlineTitle")}</h2>
          <ul className="space-y-2">
            {onlinePoints.map((p) => (
              <li key={p.id} className="rounded-[14px] border border-hairline bg-bg-tint px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {/* Часы онлайна (слайс BU): в данных они были с BN, но редактор
                      их не показывал — у онлайн-точки расписания не бывало. */}
                  {show.hours ? <OpenBadge hours={parseWeekHours(p.hours)} timezone={p.timezone} /> : null}
                </div>
                {p.website && show.website ? (
                  <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent underline">
                    {p.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                {show.hours ? (
                  <div className="mt-1.5">
                    <HoursTable hours={parseWeekHours(p.hours)} timezone={p.timezone} />
                  </div>
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
