"use client";

import { useState } from "react";
import type { AcceptedCoin, Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { CHIP, ROW_BTN, usePoiPhoto } from "@/components/coin-detail/poi-sheet-ui";
import { PoiBannerOverlay } from "@/components/coin-detail/poi-banner-overlay";
import { PoiReportDialog } from "@/components/coin-detail/poi-report-dialog";
import { reportablePointId, TILE_PAD_CLASS, TILE_SHELL } from "@/lib/poi-tile";
import { safeHttpUrl } from "@/lib/safe-url";
import { PoiHours } from "@/components/coin-detail/poi-hours";

/**
 * Страница «Карточка»: только то, что проверили мы — адрес из OSM, монеты из
 * заявки компании, часы, связь. Рассказ заведения о себе живёт на витрине: в
 * одном свитке авторство утверждений размывается.
 *
 * Сверху — плитка в пропорции банковской карты (`TILE_SHELL`) с закруглёнными
 * углами, ровно такая же, как окно карты на соседней странице: лента в 160 px
 * рекламой не была. Нажатие раскрывает баннер на весь экран, а там он
 * поднимается вверх и открывает под собой витрину заведения.
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
  const [photoOpen, setPhotoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Жалоба — только на нашу точку: чужую мы снять не можем (см. reportablePointId).
  const reportId = reportablePointId(poi.id);

  return (
    <div className="pb-4">
      {photo.image && (
        <div className={TILE_PAD_CLASS}>
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label={t("expandPhoto")}
            data-testid="poi-photo-tile"
            className={`${TILE_SHELL} block bg-bg-tint`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={photo.onError}
              className="h-full w-full object-cover"
            />
          </button>
        </div>
      )}
      {photo.loading && !photo.image && (
        <div className={TILE_PAD_CLASS}>
          <div className={`${TILE_SHELL} animate-pulse bg-bg-tint`} />
        </div>
      )}
      {photoOpen && photo.image && (
        <PoiBannerOverlay
          src={photo.image}
          poi={poi}
          locale={locale}
          onClose={() => setPhotoOpen(false)}
          t={t}
        />
      )}

      <div className="space-y-5 px-4 pt-4">
        {routeSummary && (
          <button type="button" onClick={onShowRoute} className={ROW_BTN}>
            <span aria-hidden>{routeSummary.icon}</span>
            <span className="num font-semibold">{routeSummary.text}</span>
            <span className="ml-auto text-[12px] text-muted">{t("routeOnMap")} →</span>
          </button>
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
          {/* Идущая акция заведения (слайс BG). Строка, а не плашка: обещание
              продавца не должно спорить за внимание с адресом и часами. */}
          {poi.promo && (
            <a href={`/${locale}/promo/${poi.promo.id}`} className={`${ROW_BTN} text-accent`}>
              <span aria-hidden>🎁</span>
              <span className="flex-1 truncate text-left">{poi.promo.title}</span>
            </a>
          )}
          {poi.description && <p className="text-[13px] leading-relaxed text-muted">{poi.description}</p>}

          {/* Часы: у своей точки расписание со состоянием «открыто сейчас» (BN), у
              точки зеркала BTC Map — прежний текст из тегов OSM как есть. */}
          <PoiHours hours={poi.hours} timezone={poi.timezone} fallbackText={poi.openingHours} />
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

          {poi.underReview && (
            <p className="rounded-xl bg-bg-tint px-3 py-2 text-[12px] leading-snug text-muted">
              ⚠️ {t("report.underReview")}
            </p>
          )}

          {reportId && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className={`${ROW_BTN} text-muted`}
            >
              <span aria-hidden>🚩</span>
              {t("report.button")}
            </button>
          )}
        </section>
      </div>

      {reportOpen && reportId && (
        <PoiReportDialog pointId={reportId} onClose={() => setReportOpen(false)} t={t} />
      )}
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
  // Классы повторены, а не вынесены в переменную: тест `poi-sheet-buttons`
  // читает исходник и должен видеть размер под палец прямо на элементе.
  if (!coin.slug) return <span className={`${CHIP} text-foreground`}>{inside}</span>;
  return (
    <a href={`/${locale}/coin/${coin.slug}`} className={`${CHIP} text-foreground hover:border-accent`}>
      {inside}
    </a>
  );
}
