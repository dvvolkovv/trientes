"use client";

import type { Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { CHIP, PRIMARY, ROW_BTN } from "@/components/coin-detail/poi-sheet-ui";
import { safeHttpUrl } from "@/lib/safe-url";

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
 * Страница «Витрина»: то, что заведение говорит о себе само. Пока рекламы из
 * кабинета нет (следующий слайс), она собирается из уже заявленного — все
 * фотографии точки, рассказ, связь. У чужой точки вместо пустого экрана стоит
 * приглашение забрать её себе: на карте это самый частый случай.
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
  const website = safeHttpUrl(poi.website);
  // Точка нашей компании отличается от точки зеркала BTC Map префиксом id —
  // его ставит `companyPointToPoi`, другого признака в фиде нет.
  const own = poi.id.startsWith("company/");

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

      {poi.description && <p className="text-[14px] leading-relaxed">{poi.description}</p>}

      {own && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("aboutCompany")}</h3>
          <p className="text-[13px] leading-relaxed text-muted">{poi.category}</p>
        </section>
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

      {!own && (
        <section className="space-y-2 rounded-xl border border-hairline bg-bg-tint/50 p-3">
          <p className="text-[13px] leading-snug text-muted">{t("claimTitle")}</p>
          <a href={`/${locale}/business`} className={`${PRIMARY} w-full`}>
            {t("claimCta")}
          </a>
        </section>
      )}
    </div>
  );
}
