"use client";

import type { AcceptedCoin, Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { CHIP, ROW_BTN, usePoiPhoto } from "@/components/coin-detail/poi-sheet-ui";
import { safeHttpUrl } from "@/lib/safe-url";

/**
 * Страница «Карточка»: только то, что проверили мы — адрес из OSM, монеты из
 * заявки компании, часы, связь. Рассказ заведения о себе живёт на витрине: в
 * одном свитке авторство утверждений размывается.
 */
export function PoiPaneCard({
  poi,
  locale,
  near,
  routeSummary,
  onShowRoute,
  onStreetView,
  t,
}: {
  poi: Poi;
  locale: string;
  near: boolean;
  /** Сводка активного маршрута к этой точке, уже собранная оболочкой. */
  routeSummary: { icon: string; text: string } | null;
  onShowRoute: () => void;
  onStreetView: () => void;
  t: StepTranslator;
}) {
  const website = safeHttpUrl(poi.website);
  const photo = usePoiPhoto(poi, website);
  const hasAccepted = poi.acceptedCoins.length > 0 || poi.acceptedGeneric || poi.lightning;

  return (
    <div className="space-y-5 px-4 py-4">
      {routeSummary && (
        <button type="button" onClick={onShowRoute} className={ROW_BTN}>
          <span aria-hidden>{routeSummary.icon}</span>
          <span className="num font-semibold">{routeSummary.text}</span>
          <span className="ml-auto text-[12px] text-muted">{t("routeOnMap")} →</span>
        </button>
      )}

      {photo.image && (
        <div className="overflow-hidden rounded-xl border border-hairline bg-bg-tint">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={photo.onError}
            className="h-40 w-full object-cover"
          />
        </div>
      )}
      {photo.loading && !photo.image && (
        <div className="h-40 w-full animate-pulse rounded-xl border border-hairline bg-bg-tint" />
      )}

      {hasAccepted && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("acceptedCoins")}</h3>
          <div className="flex flex-wrap gap-2">
            {poi.acceptedCoins.map((c) => (
              <CoinChip key={`${c.own ? "card" : "coin"}-${c.key}`} coin={c} locale={locale} t={t} />
            ))}
            {poi.acceptedGeneric && poi.acceptedCoins.length === 0 && (
              <span className={`${CHIP} text-muted`}>₿ {t("acceptedAny")}</span>
            )}
            {poi.lightning && <span className={`${CHIP} text-muted`}>⚡ Lightning</span>}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        {poi.description && <p className="text-[13px] leading-relaxed text-muted">{poi.description}</p>}

        {poi.openingHours && (
          <div className="flex gap-2 text-[13px] leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center text-muted">
              🕒
            </span>
            <span className="flex-1">{poi.openingHours}</span>
          </div>
        )}
        {poi.address && (
          <div className="flex gap-2 text-[13px] leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center text-muted">
              📍
            </span>
            <span className="flex-1">{poi.address}</span>
          </div>
        )}

        <button type="button" onClick={onStreetView} className={`${ROW_BTN} ${near ? "border-up" : ""}`}>
          <span aria-hidden>👁</span>
          {t("streetview")}
          {near && <span className="ml-auto text-[11px] text-up">{t("streetviewNear")}</span>}
        </button>
      </section>
    </div>
  );
}

/**
 * Чипс монеты — кнопка на её страницу. И у монеты каталога, и у нашего
 * листинга это один адрес `/coin/<slug>`: страницы различаются содержимым, а
 * не путём.
 */
function CoinChip({ coin, locale, t }: { coin: AcceptedCoin; locale: string; t: StepTranslator }) {
  const inside = (
    <>
      {coin.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coin.logoUrl} alt="" loading="lazy" className="h-5 w-5 rounded-full" />
      ) : (
        <span aria-hidden className="text-[13px]">
          ●
        </span>
      )}
      <span className="num font-medium">{coin.symbol}</span>
      {coin.own && <span className="text-[10px] uppercase tracking-wide text-accent">{t("ownListing")}</span>}
    </>
  );
  const cls = `${CHIP} text-foreground hover:border-accent`;
  if (!coin.slug) return <span className={cls}>{inside}</span>;
  return (
    <a href={`/${locale}/coin/${coin.slug}`} className={cls}>
      {inside}
    </a>
  );
}
