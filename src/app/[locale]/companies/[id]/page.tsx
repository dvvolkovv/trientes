import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CompanyLoyaltyLine } from "@/components/company/loyalty-line";
import { CompanyPromosBlock } from "@/components/company/promos-block";
import { FollowButton } from "@/components/company/follow-button";
import { MessageStoreButton } from "@/components/customer-messages/message-store-button";
import { auth } from "@/auth";
import { readFollow } from "@/lib/promos/read";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import { buildCompanyCard } from "@/lib/company-card/view";
import { AdBanner } from "@/components/company-card/ad-banner";
import { CardOffers } from "@/components/company-card/offers";
import { CardOpenBadge } from "@/components/company-card/open-badge";
import {
  CardHoursPanel,
  CardIdentity,
  CardPayments,
  CardPointBanner,
  CardRequisites,
  CardWeek,
} from "@/components/company-card/panels";
import { serializeJsonLd } from "@/lib/json-ld";
import { TranslatedBadge } from "@/components/coin-card/translated-badge";
import { DocList } from "@/components/company-card/doc-list";
import { PayButton } from "@/components/company-card/pay-button";
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

  // Карточка собирается одной функцией и рисуется теми же компонентами, что в
  // навигаторе (слайс BY): две сборки одной витрины уже расходились (BX).
  const card = await buildCompanyCard({ companyId: id, locale, original: orig === "1" });
  if (!card) notFound();

  const t = await getTranslations("companyPublic");
  const tb = await getTranslations("business");
  const tp = await getTranslations("payLink");

  // Подписка — согласие на рассылку (ТЗ 4.2), поэтому состояние читается на каждом
  // показе: отписавшийся не должен видеть «вы подписаны» до перезахода.
  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const follow = viewerId ? await readFollow(viewerId, card.id) : null;
  // Нитка одна на магазин (BQ § 2.2): уже начавшего разговор кнопка ведёт в него, а
  // сотруднику этого же предприятия писать себе снаружи незачем.
  const [ownThread, viewerMembership] = viewerId
    ? await Promise.all([
        prisma.customerThread.findUnique({
          where: { companyId_customerUserId: { companyId: card.id, customerUserId: viewerId } },
          select: { id: true },
        }),
        prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId: card.id, userId: viewerId } },
          select: { userId: true },
        }),
      ])
    : [null, null];

  const telHref = card.requisites.phone ? `tel:${card.requisites.phone.replace(/[^\d+]/g, "")}` : null;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Companies", item: `${SITE}/${locale}/companies` },
      { "@type": "ListItem", position: 2, name: card.displayName, item: `${SITE}/${locale}/companies/${id}` },
    ],
  };
  const orgLd = card.verified ? {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: card.displayName,
    legalName: card.legalName ?? undefined,
    url: `${SITE}/${locale}/companies/${id}`,
    logo: card.logoUrl ?? undefined,
    description: card.description.text ?? undefined,
    address: card.requisites.address
      ? { "@type": "PostalAddress", streetAddress: card.requisites.address }
      : undefined,
  } : null;

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

      {/* 1. Баннер: чистый кадр, управление под ним (слайс BY). */}
      {card.ads.length > 0 ? <AdBanner ads={card.ads} /> : null}

      {/* 2. Сама компания: знак, имя, лицо, место, виды, рассказ и действия. */}
      <article className="overflow-hidden rounded-[22px] border border-hairline bg-card">
        <div className="border-b border-hairline bg-card-alt/30">
          <CardIdentity card={card} />
          {card.description.text ? (
            <div className="px-5 pb-6">
              <p className="whitespace-pre-wrap text-sm md:text-base">{card.description.text}</p>
              {card.description.translated ? (
                <p className="mt-1">
                  <TranslatedBadge originalHref={`/${locale}/companies/${id}?orig=1`} />
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Действия: всё, что человек может сделать с этим предприятием, одним рядом.
            Выключатель продавца сильнее кнопки: скрытый телефон кнопки «позвонить» не
            даёт — иначе выключатель обходился бы набором номера из `tel:`. */}
        <div className="grid gap-2 px-5 py-5 sm:grid-cols-2">
          {/* «Оплатить» (слайс CP): видят все, и первой кнопкой — человек на витрине
              пришёл купить. Деньги идут прямо на кошелёк владельца магазина. */}
          {card.pay ? <PayButton href={card.pay.href} label={tp("payButton")} /> : null}
          <MessageStoreButton
            companyId={card.id}
            locale={locale}
            signedIn={viewerId !== null}
            threadId={ownThread?.id ?? null}
            isMember={viewerMembership !== null}
          />
          {telHref ? (
            <a href={telHref} className={CARD_ACTION}>
              <span aria-hidden>📞</span>
              {t("call")}
            </a>
          ) : null}
          {card.offerCount > 0 ? (
            <a href="#products" className={CARD_ACTION}>
              <span aria-hidden>🛍</span>
              {t("showcaseAction")}
            </a>
          ) : null}
          {card.mapPointId ? (
            <Link href={`/${locale}/crypto-map?point=${card.mapPointId}`} className={CARD_ACTION}>
              <span aria-hidden>📍</span>
              {t("openOnMap")}
            </Link>
          ) : null}
          {card.requisites.website ? (
            <a
              href={card.requisites.website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={CARD_ACTION}
            >
              <span aria-hidden>🔗</span>
              {t("website")}
            </a>
          ) : null}
          <FollowButton
            companyId={card.id}
            locale={locale}
            following={follow !== null}
            signedIn={viewerId !== null}
          />
        </div>
      </article>

      {/* 3. Реквизиты и контакты — одним баннером (решение владельца). */}
      <CardRequisites card={card} />

      {/* 4. Часы: состояние на одной строке с заголовком, закрыто красным. */}
      {card.hours ? <CardHoursPanel hours={card.hours} hint={t("officeHoursHint")} /> : null}

      {/* 5. Точки приёма — баннерами; нажатие ведёт в навигатор на саму точку. */}
      {card.points.length > 0 ? (
        <section className="space-y-3">
          <h2 className={`${CARD_HEADING} mb-0 px-1`}>{t("placesTitle")}</h2>
          {card.points.map((p) => (
            <div key={p.id} className="space-y-2">
              <CardPointBanner point={p} locale={locale} />
              {/* Своя неделя точки — только если она **своя**: часы предприятия уже
                  стоят выше, и вторая такая же таблица была бы тем самым «два раза
                  показывает одно и то же», на которое жаловался владелец. */}
              {p.hours && !p.hours.inherited ? (
                <div className={CARD_PANEL}>
                  <CardWeek hours={p.hours} />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* 6. Чем платят: логотипы монет и способы оплаты помимо них. */}
      <CardPayments coins={card.coins} payments={card.payments} locale={locale} />

      {/* Публичные документы (слайсы BU и BV): политика возврата полностью,
          гарантия, лицензия. Это бумаги для покупателя, а не для проверяющего;
          разметка общая с бумагами объявления (слайс CB). */}
      <DocList docs={card.documents} heading={t("documentsTitle")} />

      {/* Что продавец обещает вообще (слайс BD): ставка «на всё» и лучшая категория. */}
      <CompanyLoyaltyLine companyId={card.id} />

      {/* Акции магазина (слайс BG): объект рассылки, у него свои лимиты. Баннер выше
          их не заменяет — он витрина, его никто никому не шлёт. */}
      {card.showPromos ? <CompanyPromosBlock companyId={card.id} locale={locale} /> : null}

      {/* Витрина товаров предприятия (слайс BC) — тот же компонент, что на странице
          «Витрина» в навигаторе. */}
      <CardOffers offers={card.offers} locale={locale} />

      {card.onlinePoints.length > 0 ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("onlineTitle")}</h2>
          <ul className="space-y-2">
            {card.onlinePoints.map((p) => (
              <li key={p.id} className="rounded-[14px] border border-hairline bg-bg-tint px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.hours ? <CardOpenBadge state={p.hours.state} /> : null}
                </div>
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent underline">
                    {p.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                {p.hours ? (
                  <div className="mt-1.5">
                    <CardWeek hours={p.hours} />
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
