import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readAdMeta, readAdPage } from "@/lib/company-card/ad-page";
import { readFollow } from "@/lib/promos/read";
import { AdDetail } from "@/components/company-card/ad-detail";
import { PlaceMap } from "@/components/company-card/place-map";
import { FollowButton } from "@/components/company/follow-button";
import { MessageStoreButton } from "@/components/customer-messages/message-store-button";
import { AdPreviewBar } from "@/components/ads/ad-preview-bar";
import { DocList } from "@/components/company-card/doc-list";
import { paymentMethod } from "@/lib/payment-methods";
import { CARD_ACTION, CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";

export const dynamic = "force-dynamic";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const meta = await readAdMeta(id);
  if (!meta) return {};
  const title = `${meta.title} — ${meta.company}`;
  const description = meta.body?.slice(0, 200) ?? meta.title;
  const canonical = `${SITE}/${locale}/ad/${id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [`${SITE}${meta.image}`] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Страница рекламного материала (слайс BZ) — то самое «отдельное место», куда ведёт
 * нажатие на баннер.
 *
 * Покупки здесь нет и быть не может: платежей и кошелька в проекте нет ни одного, и
 * кнопка «купить» обещала бы оплату, которой не будет. Переход к товару ведёт на
 * паспорт с ценой, а оплата идёт вне платформы — так и написано строкой.
 *
 * Публичных комментариев тоже нет: обсуждение, которое видят все, требует модерации,
 * жалобы, блокировки и защиты от заваливания — это отдельный слайс, а не кнопка
 * (разбор BQ). Вместо него — приватный вопрос магазину, у него есть ответственный.
 */
export default async function AdPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ orig?: string }>;
}) {
  const { locale, id } = await params;
  const { orig } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const view = await readAdPage({ adId: id, locale, original: orig === "1", viewerId });
  if (!view) notFound();
  const { ad, card, siblings } = view;

  const t = await getTranslations("adPage");
  const tc = await getTranslations("companyCard");
  const tp = await getTranslations("companyPublic");
  const follow = viewerId ? await readFollow(viewerId, card.id) : null;
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

  const place = ad.place;

  return (
    <main className="mx-auto w-full max-w-[760px] space-y-4 px-4 py-8 md:px-6 md:py-12">
      <nav className="text-xs text-muted">
        <Link href={`/${locale}/companies/${card.id}`} className="hover:text-foreground">
          ← {card.displayName}
        </Link>
      </nav>

      {/* Предпросмотр до публикации (слайс CB): всё то же самое, что увидит
          покупатель, плюс честная плашка и кнопка «опубликовать». */}
      {view.preview ? (
        <AdPreviewBar
          status={view.status}
          hasPending={view.hasPending}
          canManage={view.canManage}
          rejectionReason={view.rejectionReason}
          adId={ad.id}
          studioHref={`/${locale}/cabinet/companies/${card.id}/ads?ad=${ad.id}`}
        />
      ) : null}

      <AdDetail ad={ad} />

      {/* Действие материала. У товара под кнопкой стоит честная строка об оплате.
          Действие, ведущее на место самого материала, тут не рисуется: ниже стоит
          раздел «Где это» с картой и той же кнопкой — две кнопки в одно место
          читались бы как два разных адреса. */}
      {ad.action && !ad.action.fromPlace ? (
        <div>
          <a
            href={ad.action.href}
            {...(ad.action.kind === "WEBSITE" ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
            className="flex h-14 items-center justify-center gap-2 rounded-[16px] bg-accent text-[14px] font-bold text-accent-foreground"
          >
            {ad.action.kind === "PRODUCT" ? "🛍" : ad.action.kind === "POINT" ? "📍" : "🔗"}
            {tc(`ad.action.${ad.action.kind}`)}: {ad.action.label}
          </a>
          {ad.action.kind === "PRODUCT" ? (
            <p className="mt-1.5 px-1 text-[11.5px] text-muted">{t("paymentOutside")}</p>
          ) : null}
        </div>
      ) : null}

      {/* Место материала: объект рекламы, а не точка приёма — на общей карте его нет. */}
      {place ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("placeTitle")}</h2>
          {place.name ? <p className="text-[15px] font-semibold">{place.name}</p> : null}
          {place.address ? <p className="text-sm text-muted-strong">{place.address}</p> : null}

          <div className="mt-3">
            <PlaceMap
              lat={place.lat}
              lon={place.lon}
              label={place.name ?? card.displayName}
              logoUrl={card.logoUrl}
            />
          </div>

          {place.coins.length > 0 || place.payments.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">{t("placeAccepts")}</p>
              <div className="flex flex-wrap gap-1.5">
                {place.coins.map((c) => (
                  <span
                    key={c.key}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5 text-[12px] font-semibold"
                  >
                    {c.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logoUrl} alt="" className="h-4 w-4 rounded-full" />
                    ) : null}
                    {c.symbol}
                  </span>
                ))}
                {place.payments.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5 text-[12px] font-semibold"
                  >
                    <span aria-hidden>{paymentMethod(p)?.emoji}</span>
                    {tc(`payment.${p}`)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Адрес называет материал, а не координату: тогда карта ставит на
              место знак предприятия (просьба владельца 23 ноября). */}
          <Link href={`/${locale}/crypto-map?ad=${ad.id}`} className={`${CARD_ACTION} mt-3`}>
            <span aria-hidden>🗺</span>
            {tp("openOnMap")}
          </Link>
        </section>
      ) : null}

      {/* Бумаги этого объявления (слайс CB): разрешения, лицензии, декларации —
          то, чем продавец подкрепляет сказанное на баннере. Бумаги предприятия
          живут на его витрине: это разные обещания. */}
      <DocList docs={ad.documents} heading={t("documentsTitle")} />

      {/* Что человек может сделать: следить, спросить, открыть профиль. */}
      <section className="grid gap-2 sm:grid-cols-2">
        <MessageStoreButton
          companyId={card.id}
          locale={locale}
          signedIn={viewerId !== null}
          threadId={ownThread?.id ?? null}
          isMember={viewerMembership !== null}
        />
        <FollowButton
          companyId={card.id}
          locale={locale}
          following={follow !== null}
          signedIn={viewerId !== null}
        />
        <Link href={`/${locale}/companies/${card.id}`} className={CARD_ACTION}>
          <span aria-hidden>🏢</span>
          {t("companyProfile")}
        </Link>
      </section>

      {siblings.length > 0 ? (
        <section className={CARD_PANEL}>
          <h2 className={CARD_HEADING}>{t("moreTitle")}</h2>
          <ul className="space-y-2">
            {siblings.map((s) => (
              <li key={s.id}>
                <Link href={s.href} className="flex items-center gap-3 rounded-[14px] border border-hairline bg-card-alt p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt="" className="h-[52px] w-[84px] shrink-0 rounded-[10px] object-cover" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{s.title}</span>
                  <span aria-hidden className="text-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
