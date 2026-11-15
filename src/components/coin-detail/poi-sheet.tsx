"use client";

import { useEffect, useState } from "react";
import type { OgPreview, Poi, RouteMode, RouteStep, TransitLeg } from "@/lib/crypto-map";
import { safeHttpUrl } from "@/lib/safe-url";
import { footerActions } from "@/lib/poi-sheet-actions";
import { StepList, type StepTranslator } from "@/components/coin-detail/route-steps-panel";

export const MODE_ICON: Record<RouteMode, string> = { walk: "🚶", car: "🚗", transit: "🚍" };
const TRAVEL_MODES: RouteMode[] = ["walk", "car", "transit"];

const LAYER_DOT: Record<string, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
  fintech: "#A855F7",
};

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

/** Маршрут, который карточка показывает: сводка + геометрия для ведения. */
export type SheetRoute = {
  distance: number;
  duration: number;
  mode: RouteMode;
  transfers?: number;
  legs?: TransitLeg[];
  steps?: RouteStep[];
  coordinates: [number, number][];
};

const LEG_ICON: Record<string, string> = {
  WALK: "🚶",
  SUBWAY: "🚇",
  METRO: "🚇",
  RAIL: "🚆",
  REGIONAL_RAIL: "🚆",
  REGIONAL_FAST_RAIL: "🚆",
  LONG_DISTANCE: "🚆",
  HIGHSPEED_RAIL: "🚄",
  NIGHT_RAIL: "🚆",
  BUS: "🚌",
  COACH: "🚌",
  TRAM: "🚊",
  FERRY: "⛴️",
};

function legIcon(mode: string): string {
  return LEG_ICON[mode.toUpperCase()] ?? "🚆";
}

// Кнопка под палец: 44 px — минимум, по которому попадают не глядя.
const TAP = "min-h-[44px] rounded-xl text-[13px] font-medium transition-all flex items-center gap-2 px-3";
const PRIMARY = `${TAP} justify-center bg-accent text-accent-foreground hover:opacity-90 font-semibold`;
const SECONDARY = `${TAP} justify-center border border-hairline text-foreground hover:border-accent`;
const ROW_BTN = `${TAP} w-full border border-hairline text-foreground hover:border-accent bg-bg-tint/40`;

/**
 * Карточка точки. На телефоне — на весь экран (развёрнуто) или нижним листом
 * поверх карты (пристыковано); на десктопе — панель внутри окна карты.
 * Прежде это был `maplibregl.Popup` шириной 240 px: на телефоне в него не
 * попадал палец и до управления маршрутом приходилось скроллить.
 */
export function PoiSheet({
  poi,
  locale,
  route,
  mode,
  status,
  hasOrigin,
  near,
  navActive,
  voiceOn,
  voiceSupported,
  expanded,
  onExpandedChange,
  onClose,
  onMode,
  onBuildRoute,
  onGo,
  onClearRoute,
  onStreetView,
  onLocate,
  onToggleVoice,
  t,
}: {
  poi: Poi;
  locale: string;
  route: SheetRoute | null;
  mode: RouteMode;
  status: string | null;
  hasOrigin: boolean;
  near: boolean;
  navActive: boolean;
  voiceOn: boolean;
  voiceSupported: boolean;
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onClose: () => void;
  onMode: (next: RouteMode) => void;
  onBuildRoute: () => void;
  onGo: () => void;
  onClearRoute: () => void;
  onStreetView: () => void;
  onLocate: () => void;
  onToggleVoice: () => void;
  t: StepTranslator;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);

  // Прокрутка страницы под листом на телефоне гасится так же, как под
  // бургер-меню: иначе палец листает страницу вместо карточки.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const phone = window.matchMedia("(max-width: 767px)");
    if (!phone.matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const website = safeHttpUrl(poi.website);
  const photo = usePoiPhoto(poi, website);

  const container = [
    "z-[60] flex flex-col overflow-hidden bg-card text-foreground shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.6)]",
    expanded
      ? "fixed inset-0"
      : "fixed inset-x-0 bottom-0 max-h-[55vh] rounded-t-[22px] border-t border-hairline",
    // Десктоп: панель внутри карты и слева — справа стоят кнопки масштаба,
    // компас и «моё положение», и панель их перекрывала бы.
    "md:absolute md:inset-y-3 md:right-auto md:left-3 md:top-3 md:bottom-3 md:w-[380px] md:max-h-none md:rounded-[18px] md:border md:border-hairline",
  ].join(" ");

  const actions = footerActions(!!route);

  return (
    <div className={container} role="dialog" aria-label={poi.name}>
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-label={expanded ? t("collapseCard") : t("expandCard")}
        aria-expanded={expanded}
        className="mx-auto flex h-7 w-24 shrink-0 items-center justify-center md:hidden"
      >
        <span className="h-1.5 w-11 rounded-full bg-hairline" />
      </button>

      <div className="flex shrink-0 items-start gap-2 border-b border-hairline px-4 pb-3 pt-1 md:pt-3">
        <span
          aria-hidden
          className="mt-[7px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: LAYER_DOT[poi.layer] ?? "#30B658" }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-tight">{poi.name}</div>
          <div className="truncate text-[12px] text-muted">
            {poi.category}
            {poi.lightning ? " · ⚡ Lightning" : ""}
            {poi.coinSpecific ? " · ✓" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[18px] text-muted hover:bg-bg-tint hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {/* ---- Маршрут: первым, потому что за ним сюда и пришли ---- */}
        <section className="space-y-2.5">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("routeTitle")}</h3>

          {!hasOrigin && (
            <button type="button" onClick={onLocate} className={`${SECONDARY} w-full`}>
              📍 {t("myLocation")}
            </button>
          )}

          <div className="grid grid-cols-3 gap-2">
            {TRAVEL_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMode(m)}
                aria-pressed={mode === m}
                className={
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[12px] font-medium transition-all " +
                  (mode === m
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-hairline text-muted hover:text-foreground")
                }
              >
                <span aria-hidden className="text-[18px] leading-none">
                  {MODE_ICON[m]}
                </span>
                {t(`mode_${m}`)}
              </button>
            ))}
          </div>

          {route && (
            <div className="rounded-xl border border-hairline bg-bg-tint/50 px-3 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-muted">
                  {t("duration")}:{" "}
                  <span className="num font-semibold text-foreground">
                    {t("etaMin", { min: Math.max(1, Math.round(route.duration / 60)) })}
                  </span>
                </span>
                <span className="text-muted">
                  {t("distance")}:{" "}
                  <span className="num font-semibold text-foreground">
                    {route.distance >= 1000
                      ? `${(route.distance / 1000).toFixed(1)} km`
                      : `${Math.round(route.distance)} m`}
                  </span>
                </span>
              </div>
              {route.mode === "transit" && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                  <span>{route.transfers ? t("transfers", { count: route.transfers }) : t("transitDirect")}</span>
                  {route.legs?.map((lg, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-muted/50">›</span>}
                      <span style={{ color: lg.dashed ? undefined : lg.color }}>
                        {legIcon(lg.mode)}
                        {lg.line ? ` ${lg.line}` : ""}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {!!route.steps?.length && (
                <>
                  <button
                    type="button"
                    onClick={() => setStepsOpen((v) => !v)}
                    aria-expanded={stepsOpen}
                    className="mt-1.5 flex min-h-[36px] items-center gap-1.5 text-[12px] text-muted hover:text-foreground"
                  >
                    <span aria-hidden>{stepsOpen ? "▾" : "▸"}</span>
                    {t("directions")}
                  </button>
                  {stepsOpen && <StepList steps={route.steps} t={t} />}
                </>
              )}
            </div>
          )}

          {voiceSupported && !navActive && (
            <button
              type="button"
              onClick={onToggleVoice}
              aria-pressed={voiceOn}
              className={
                `${TAP} w-full border ` +
                (voiceOn
                  ? "border-accent/40 bg-accent/10 text-foreground"
                  : "border-hairline text-muted hover:text-foreground")
              }
            >
              <span aria-hidden>{voiceOn ? "🔊" : "🔇"}</span>
              {voiceOn ? t("voiceOn") : t("voiceOff")}
            </button>
          )}

          {status && <p className="text-[12px] leading-snug text-accent">{status}</p>}
          {!hasOrigin && !status && <p className="text-[11px] text-muted/70">{t("clickToDrop")}</p>}
        </section>

        {/* ---- Что это за место ---- */}
        <section className="space-y-2.5">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("detailsTitle")}</h3>

          {photo.image && (
            <div className="relative overflow-hidden rounded-xl border border-hairline bg-bg-tint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.image}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={photo.onError}
                className="h-40 w-full object-cover"
              />
              {photo.video && website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-2.5 py-1 text-[12px] text-white"
                >
                  ▶ {t("watchVideo")}
                </a>
              )}
            </div>
          )}
          {photo.loading && !photo.image && (
            <div className="h-40 w-full animate-pulse rounded-xl border border-hairline bg-bg-tint" />
          )}

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
          {poi.layer === "fintech" && poi.slug && (
            <a href={`/${locale}/fintech/${poi.slug}`} className={ROW_BTN}>
              <span aria-hidden>🏛</span>
              {t("viewProfile")}
              <span className="ml-auto text-muted">→</span>
            </a>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={ROW_BTN}>
              <span aria-hidden>🌐</span>
              {t("openSite")}
              <span className="ml-auto text-muted">↗</span>
            </a>
          )}

          {poi.socials.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {poi.socials.map((s) => (
                <a
                  key={`${s.network}-${s.url}`}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex min-h-[40px] items-center rounded-full border border-hairline px-3.5 text-[12px] text-muted hover:border-accent hover:text-foreground"
                >
                  {SOCIAL_LABELS[s.network] ?? s.network}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---- Подвал: главное действие всегда под пальцем ---- */}
      <div
        className="shrink-0 space-y-2 border-t border-hairline bg-card px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {actions.map((a) => {
          const handler =
            a.key === "go" ? onGo : a.key === "routeHere" ? onBuildRoute : onClearRoute;
          if (a.kind === "text") {
            return (
              <button
                key={a.key}
                type="button"
                onClick={handler}
                className="flex min-h-[40px] w-full items-center justify-center text-[12px] text-muted hover:text-foreground"
              >
                {t(a.labelKey)}
              </button>
            );
          }
          return (
            <button
              key={a.key}
              type="button"
              onClick={handler}
              className={`${a.kind === "primary" ? PRIMARY : SECONDARY} w-full`}
            >
              {a.key === "go" ? `▶ ${t(a.labelKey)}` : t(a.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type PhotoState = { image: string | null; video: string | null; loading: boolean; onError: () => void };

/**
 * Снимок места: сначала картинка из OSM (если есть), затем — OpenGraph сайта
 * заведения. Битая картинка прячет слот целиком: сломанная иконка хуже пустоты.
 * Состояние не пересобирается под новую точку — навигатор монтирует лист
 * заново на каждую точку (`key`), так что начальных значений достаточно.
 */
function usePoiPhoto(poi: Poi, website: string | null): PhotoState {
  const [image, setImage] = useState<string | null>(poi.image);
  const [video, setVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!poi.image && !!website);

  useEffect(() => {
    if (!website) return;
    let cancelled = false;
    fetch(`/api/crypto-map/preview?url=${encodeURIComponent(website)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((res: { preview?: OgPreview }) => {
        if (cancelled) return;
        const og = res.preview ?? { title: null, image: null, video: null };
        if (og.image) setImage(og.image);
        setVideo(og.video ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [website]);

  return { image, video, loading, onError: () => setImage(null) };
}
