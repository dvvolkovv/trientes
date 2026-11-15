"use client";

import { useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { Poi, RouteMode } from "@/lib/crypto-map";
import { handoffPlatform, handoffUrl } from "@/lib/nav-handoff";
import {
  MODE_ICON,
  PRIMARY,
  SECONDARY,
  TAP,
  formatDistance,
  type SheetRoute,
} from "@/components/coin-detail/poi-sheet-ui";
import { useTileGesture } from "@/components/coin-detail/poi-sheet-ui";
import { StepList, type StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { TransitItinerary, legIcon } from "@/components/coin-detail/transit-itinerary";
import { MapControls } from "@/components/coin-detail/map-controls";
import type { CompassMode } from "@/lib/compass-mode";
import { footerActions } from "@/lib/poi-sheet-actions";
import { SWIPE_EDGE_PX } from "@/lib/poi-pager";
import { TILE_PAD_CLASS, TILE_SHELL } from "@/lib/poi-tile";

const TRAVEL_MODES: RouteMode[] = ["walk", "car", "transit"];

// Платформа не меняется за время жизни страницы, но спросить её можно только
// после гидратации: на сервере `navigator` нет, а разметка должна совпасть.
const subscribeNever = () => () => {};
const readPlatform = () => handoffPlatform(navigator.userAgent);

const HANDOFF_LABEL = { apple: "handoffApple", google: "handoffGoogle", web: "handoffWeb" } as const;

/**
 * Страница «Карта» — не карта, а окно в неё. Полотно MapLibre живёт в
 * навигаторе и никуда не переезжает: перенос канваса в другое место DOM
 * заставил бы MapLibre пересоздать контекст, и сбились бы линия маршрута,
 * положение и ведение — ровно то, на что была жалоба. Поэтому окно прозрачно,
 * а непрозрачны только части страницы вокруг него.
 *
 * Окно живёт в двух состояниях. Свёрнутое — плитка в пропорции банковской
 * карты с закруглёнными углами, такая же, как баннер на «Месте»; под ней, на непрозрачном фоне, всё
 * управление маршрутом. Свёрнутая плитка **берёт нажатие на себя**: нажатие на
 * пустое место карты означает «поставь сюда мою булавку», и в окошке размером с
 * кредитку это была бы ловушка. Раскрытое окно событий не берёт — палец
 * достаёт до карты, — поэтому сворачивает его отдельная ручка сверху.
 *
 * `tileRef` отдаётся навигатору: `fitRoute()` вписывает маршрут в прямоугольник
 * окна, каким бы оно сейчас ни было.
 */
export function PoiPaneMap({
  poi,
  route,
  mode,
  status,
  hasOrigin,
  voiceOn,
  voiceSupported,
  tileRef,
  expanded,
  docked,
  onExpandedChange,
  onMode,
  onBuildRoute,
  onGo,
  onClearRoute,
  onLocate,
  onToggleVoice,
  view,
  compassMode,
  onZoomIn,
  onZoomOut,
  onCompass,
  t,
}: {
  poi: Poi;
  route: SheetRoute | null;
  mode: RouteMode;
  status: string | null;
  hasOrigin: boolean;
  voiceOn: boolean;
  voiceSupported: boolean;
  tileRef: RefObject<HTMLDivElement | null>;
  /** Окно во весь доступный экран вместо плитки. */
  expanded: boolean;
  /** На десктопе та же полоса стоит подвалом панели, а окна в карту там нет. */
  docked: boolean;
  onExpandedChange: (next: boolean) => void;
  onMode: (next: RouteMode) => void;
  onBuildRoute: () => void;
  onGo: () => void;
  onClearRoute: () => void;
  onLocate: () => void;
  onToggleVoice: () => void;
  /** Поворот и наклон карты — компас под окном показывает, где север. */
  view: { bearing: number; pitch: number };
  /** Север вверх или карта по курсу движения. */
  compassMode: CompassMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCompass: () => void;
  t: StepTranslator;
}) {
  // `null` — человек ещё не решал, и тогда решает режим: нитку поездки в
  // транспорте надо видеть сразу (в ней и весь ответ на «где мне садиться»),
  // а список манёвров пешего маршрута длинный и прячется по-прежнему.
  const [stepsOpen, setStepsOpen] = useState<boolean | null>(null);
  const transitPlan = route?.mode === "transit";
  const planOpen = stepsOpen ?? transitPlan;
  const actions = footerActions(!!route);
  const platform = useSyncExternalStore(subscribeNever, readPlatform, () => "web" as const);
  const { handlers, dragging } = useTileGesture({ expanded, onChange: onExpandedChange });
  const toggle = () => {
    // Протяжка заканчивается щелчком по тому же элементу — её решение уже
    // принято жестом, второй раз переключать нельзя.
    if (dragging()) return;
    onExpandedChange(!expanded);
  };

  const controls = (
      <div
        className={
          // `relative` здесь не про положение, а про порядок рисования: окно
          // карты позиционировано, а значит рисуется поверх обычных соседей —
          // его тень-заливка закрасила бы полосу управления собой.
          "pointer-events-auto relative space-y-2 px-4 pt-3 " +
          (docked
            ? "bg-card"
            : expanded
              ? "shrink-0 border-t border-hairline bg-card/95 backdrop-blur"
              : "min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hairline bg-card")
        }
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* «Моё положение» теперь кнопка самого ряда управления картой —
            отдельной широкой кнопки рядом с ним быть не должно, иначе одна
            и та же команда стоит в карточке дважды. */}
        <div className="flex items-center gap-2">
          <MapControls
            bearing={view.bearing}
            pitch={view.pitch}
            compassMode={compassMode}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onCompass={onCompass}
            onLocate={onLocate}
            t={t}
          />
        </div>

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
                <span className="num font-semibold text-foreground">{formatDistance(route.distance)}</span>
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
            {/* Разбор маршрута: у пешего и автомобильного это манёвры, у
                транспорта — нитка поездки. У составного маршрута манёвров нет
                вовсе, и раньше кнопка просто не появлялась: человек видел
                «3 пересадки» и ни одного имени остановки. */}
            {(transitPlan ? !!route.legs?.length : !!route.steps?.length) && (
              <>
                <button
                  type="button"
                  onClick={() => setStepsOpen(!planOpen)}
                  aria-expanded={planOpen}
                  className="mt-1.5 flex min-h-[36px] items-center gap-1.5 text-[12px] text-muted hover:text-foreground"
                >
                  <span aria-hidden>{planOpen ? "▾" : "▸"}</span>
                  {transitPlan ? t("transitPlan") : t("directions")}
                </button>
                {planOpen && (
                  <div className="max-h-[32vh] overflow-y-auto overscroll-contain">
                    {transitPlan ? (
                      <TransitItinerary legs={route.legs ?? []} t={t} />
                    ) : (
                      <StepList steps={route.steps ?? []} t={t} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Передача родному навигатору: единственная дорога на экран машины.
            CarPlay и Android Auto рисуют нативными шаблонами, в которые
            WebView не вставляется, — зато родной навигатор телефона в этих
            шаблонах уже живёт. Отдаём ему точку, маршрут он построит свой. */}
        <a
          href={handoffUrl(platform, { lat: poi.lat, lon: poi.lon, name: poi.name }, mode)}
          target={platform === "web" ? "_blank" : undefined}
          rel={platform === "web" ? "noopener noreferrer" : undefined}
          className={`${SECONDARY} w-full`}
        >
          <span aria-hidden>🚘</span>
          {t(HANDOFF_LABEL[platform])}
        </a>
        <p className="text-[11px] leading-snug text-muted/70">{t("handoffHint")}</p>

        {voiceSupported && (
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

        {actions.map((a) => {
          const handler = a.key === "go" ? onGo : a.key === "routeHere" ? onBuildRoute : onClearRoute;
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
  );

  if (docked) return <div className="flex flex-col">{controls}</div>;

  return (
    <div className="pointer-events-none flex h-full flex-col">
      <div className={expanded ? "min-h-0 flex-1" : `shrink-0 ${TILE_PAD_CLASS}`}>
        <div
          ref={tileRef}
          data-testid="poi-map-tile"
          className={"relative " + (expanded ? "h-full w-full" : TILE_SHELL)}
          // Окно — дыра в карточке: всё, что вокруг него, закрашивает тень
          // самой плитки. Четыре полосы фона вокруг прямоугольника нарисовали
          // бы то же самое, но закруглённых углов у дыры от них не бывает.
          style={expanded ? undefined : { boxShadow: "0 0 0 100vmax var(--color-card)" }}
        >
          {expanded ? (
            <>
              <div className="absolute inset-x-0 top-0 flex justify-center p-2">
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={t("collapseMap")}
                  {...handlers}
                  className="pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border border-hairline bg-card/90 px-4 text-[12px] font-medium text-muted backdrop-blur hover:text-foreground"
                >
                  ▾ {t("collapseMap")}
                </button>
              </div>
              {/* Раскрытая карта забирает палец себе, и листалке остаются две
                  полоски у краёв — иначе уйти со страницы можно только
                  закладкой. Прозрачные и без подписи: это не кнопка, а поле
                  жеста, который разбирает `claimsSwipe`. */}
              <span
                aria-hidden
                data-testid="poi-swipe-edge-left"
                className="pointer-events-auto absolute inset-y-0 left-0"
                style={{ width: SWIPE_EDGE_PX }}
              />
              <span
                aria-hidden
                data-testid="poi-swipe-edge-right"
                className="pointer-events-auto absolute inset-y-0 right-0"
                style={{ width: SWIPE_EDGE_PX }}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={toggle}
              aria-label={t("expandMap")}
              {...handlers}
              className="pointer-events-auto absolute inset-0 flex items-end justify-end p-2"
            >
              <span className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-hairline bg-card/90 px-3 text-[11px] font-medium text-muted backdrop-blur">
                ⤢ {t("expandMap")}
              </span>
            </button>
          )}
        </div>
      </div>
      {controls}
    </div>
  );
}
