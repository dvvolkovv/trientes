"use client";

import { useTranslations } from "next-intl";
import type { Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { CHIP, PRIMARY, ROW_BTN } from "@/components/coin-detail/poi-sheet-ui";
import { CardOffers } from "@/components/company-card/offers";
import { useCompanyCard } from "@/components/company-card/use-company-card";
import { safeHttpUrl } from "@/lib/safe-url";
import { poiIdToOsmKey } from "@/lib/osm-key";

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  vk: "VK",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
};

/**
 * Страница «Витрина».
 *
 * Решение владельца (слайс BY): **витрина — это витрина**, на ней стоят товары и
 * услуги с действиями. Адрес, телефон, сайт, реквизиты и соцсети с неё ушли — они
 * стоят в карточке на странице «Место», и одна вещь в двух местах расходится.
 *
 * Правило касается **нашей** точки: у точки зеркала BTC Map и у финтех-точки
 * карточки предприятия нет вовсе, и витрина остаётся им прежней — фотографии,
 * рассказ, связь и приглашение забрать точку себе. Иначе чужая точка осталась бы
 * пустым экраном.
 */
export function PoiPaneShowcase({
  poi,
  locale,
  t,
}: {
  poi: Poi;
  locale: string;
  t: StepTranslator;
}) {
  const tc = useTranslations("common");
  const website = safeHttpUrl(poi.website);
  // Точка нашей компании отличается от точки зеркала BTC Map префиксом id —
  // его ставит `companyPointToPoi`, другого признака в фиде нет.
  const own = poi.id.startsWith("company/");
  // Забрать себе можно только точку зеркала BTC Map: у неё нет хозяина.
  const osmKey = poiIdToOsmKey(poi.id);
  const card = useCompanyCard(own ? poi.companyId : null, locale);

  if (own) {
    return (
      <div className="space-y-4 px-4 py-4">
        {card && card.offers.length > 0 ? (
          <CardOffers offers={card.offers} locale={locale} bare />
        ) : (
          <p className="text-[13px] text-muted">{t("showcaseEmpty")}</p>
        )}
        {poi.companyId ? (
          <a href={`/${locale}/companies/${poi.companyId}`} className={ROW_BTN}>
            <span aria-hidden>🏢</span>
            {t("openCompany")}
            <span className="ml-auto text-muted">→</span>
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4">
      {poi.photos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("showcasePhotos")}</h3>
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
            {poi.photos.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-44 w-[78%] shrink-0 snap-center rounded-xl border border-hairline object-cover"
              />
            ))}
          </div>
        </section>
      )}

      {poi.description && (
        <p className="text-[14px] leading-relaxed">
          {poi.description}
          {poi.descriptionTranslated ? (
            <span className="ml-2 rounded border border-hairline px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-[0.12em]">
              {tc("machineTranslated")}
            </span>
          ) : null}
        </p>
      )}

      <section className="space-y-2">
        {poi.phone && (
          <a href={`tel:${poi.phone}`} className={ROW_BTN}>
            <span aria-hidden>📞</span>
            {t("call")}
            <span className="num ml-auto truncate text-[12px] text-muted">{poi.phone}</span>
          </a>
        )}
        {poi.email && (
          <a href={`mailto:${poi.email}`} className={ROW_BTN}>
            <span aria-hidden>✉️</span>
            {t("write")}
            <span className="ml-auto truncate text-[12px] text-muted">{poi.email}</span>
          </a>
        )}
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={ROW_BTN}>
            <span aria-hidden>🌐</span>
            {t("openSite")}
            <span className="ml-auto text-muted">↗</span>
          </a>
        )}
        {poi.layer === "fintech" && poi.slug && (
          <a href={`/${locale}/fintech/${poi.slug}`} className={ROW_BTN}>
            <span aria-hidden>🏛</span>
            {t("viewProfile")}
            <span className="ml-auto text-muted">→</span>
          </a>
        )}
      </section>

      {poi.socials.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {poi.socials.map((s) => (
            <a
              key={`${s.network}-${s.url}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`${CHIP} text-muted hover:border-accent hover:text-foreground`}
            >
              {SOCIAL_LABELS[s.network] ?? s.network}
            </a>
          ))}
        </div>
      )}

      {osmKey && (
        <section className="space-y-2 rounded-xl border border-hairline bg-bg-tint/50 p-3">
          <p className="text-[13px] leading-snug text-muted">{t("claimTitle")}</p>
          <a href={`/${locale}/claim/${encodeURIComponent(osmKey)}`} className={`${PRIMARY} w-full`}>
            {t("claimCta")}
          </a>
        </section>
      )}
    </div>
  );
}
