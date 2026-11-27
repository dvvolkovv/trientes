"use client";

import { useState } from "react";
import type { Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { CHIP, ROW_BTN, usePoiPhoto } from "@/components/coin-detail/poi-sheet-ui";
import { PoiBannerOverlay } from "@/components/coin-detail/poi-banner-overlay";
import { PoiReportDialog } from "@/components/coin-detail/poi-report-dialog";
import { reportablePointId, TILE_PAD_CLASS, TILE_SHELL } from "@/lib/poi-tile";
import { safeHttpUrl } from "@/lib/safe-url";
import { PoiHours } from "@/components/coin-detail/poi-hours";
import { AdBanner } from "@/components/company-card/ad-banner";
import { CardPayments, CardRequisites } from "@/components/company-card/panels";
import { PayButton } from "@/components/company-card/pay-button";
import { useCompanyCard } from "@/components/company-card/use-company-card";
import { useTranslations } from "next-intl";

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
  const tc = useTranslations("common");
  const tp = useTranslations("payLink");
  const website = safeHttpUrl(poi.website);
  const photo = usePoiPhoto(poi, website);
  const hasAccepted = poi.acceptedCoins.length > 0 || poi.acceptedGeneric || poi.lightning;
  const [photoOpen, setPhotoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Жалоба — только на нашу точку: чужую мы снять не можем (см. reportablePointId).
  const reportId = reportablePointId(poi.id);
  // Та же карточка, что на витрине предприятия (слайс BY): владелец просил показывать
  // её и здесь «в таком же виде». Берётся отдельным запросом при открытии точки.
  const card = useCompanyCard(poi.companyId, locale);

  return (
    <div className="pb-4">
      {/* Баннер предприятия: чистый кадр, управление под ним. Он старше плитки
          фотографии — это то, что предприятие само хочет сказать первым. */}
      {card && card.ads.length > 0 ? (
        <div className={TILE_PAD_CLASS}>
          <AdBanner ads={card.ads} />
        </div>
      ) : null}
      {!card?.ads.length && photo.image && (
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
      {photo.loading && !photo.image && !card?.ads.length && (
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

        {/* Чем платят — тот же баннер, что на витрине (слайс BY), но монеты берутся
            **у точки**: у неё набор бывает уже, чем у предприятия, и показать здесь
            весь список предприятия значило бы обещать приём там, где его нет. */}
        {hasAccepted || card?.payments.length ? (
          <section className="space-y-2">
            <CardPayments coins={poi.acceptedCoins} payments={card?.payments ?? []} locale={locale} />
            {(poi.acceptedGeneric && poi.acceptedCoins.length === 0) || poi.lightning ? (
              <div className="flex flex-wrap gap-2">
                {poi.acceptedGeneric && poi.acceptedCoins.length === 0 && (
                  <span className={`${CHIP} text-muted`}>₿ {t("acceptedAny")}</span>
                )}
                {poi.lightning && <span className={`${CHIP} text-muted`}>⚡ Lightning</span>}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-2.5">
          {/* «Оплатить» (слайс CP): та же кнопка, что на витрине, и первой — человек,
              стоящий у прилавка, пришёл заплатить. Видят её все. */}
          {card?.pay ? <PayButton href={card.pay.href} label={tp("payButton")} /> : null}
          {/* Идущая акция заведения (слайс BG). Строка, а не плашка: обещание
              продавца не должно спорить за внимание с адресом и часами. */}
          {poi.promo && (
            <a href={`/${locale}/promo/${poi.promo.id}`} className={`${ROW_BTN} text-accent`}>
              <span aria-hidden>🎁</span>
              <span className="flex-1 truncate text-left">{poi.promo.title}</span>
            </a>
          )}
          {poi.description && (
            <p className="text-[13px] leading-relaxed text-muted">
              {poi.description}
              {/* Перевод — производный текст, а не само заявление продавца: знак
                  стоит там же, где на витрине (решение BB и карточки монеты). */}
              {poi.descriptionTranslated ? (
                <span className="ml-2 rounded border border-hairline px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] align-middle">
                  {tc("machineTranslated")}
                </span>
              ) : null}
            </p>
          )}

          {/* Часы: у своей точки расписание со состоянием «открыто сейчас» (BN), у
              точки зеркала BTC Map — прежний текст из тегов OSM как есть. */}
          <PoiHours
            hours={poi.hours}
            timezone={poi.timezone}
            fallbackText={poi.openingHours}
            title={t("hoursTitle")}
            note={poi.hoursFrom === "company" ? t("hoursFromCompany") : null}
          />
          {poi.address && (
            <div className="flex gap-2 text-[13px] leading-snug">
              <span aria-hidden className="w-5 shrink-0 text-center text-muted">
                📍
              </span>
              <span className="flex-1">{poi.address}</span>
            </div>
          )}

          {/* Товары живут на странице «Витрина» (решение владельца, слайс BY):
              витрина — это товары и услуги, а «Место» — про само место. Одна вещь в
              двух местах расходится. */}

          {/* Политика возврата (BW): показывается там же, где названа цена, — то
              есть рядом с товаром, а не в конце карточки. У нашей точки её несёт
              карточка предприятия ниже, и вторая такая же строка была бы повтором. */}
          {!card && (poi.returnPolicy || poi.returnDays) && (
            <div className="flex gap-2 text-[13px] leading-snug">
              <span aria-hidden className="w-5 shrink-0 text-center text-muted">↩️</span>
              <span className="flex-1 text-muted">
                <span className="text-foreground">{t("returnsTitle")}</span>
                {poi.returnDays ? ` · ${t("returnsDays", { days: poi.returnDays })}` : ""}
                {poi.returnPolicy ? ` · ${poi.returnPolicy}` : ""}
              </span>
            </div>
          )}

          {/* Реквизиты и контакты одним баннером и «принимаем к оплате» — те же
              компоненты, что на витрине: карточка одна. */}
          {card ? <CardRequisites card={card} hideAddress /> : null}

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
