"use client";

import { useState } from "react";
import type { RefObject } from "react";
import type { RouteMode } from "@/lib/crypto-map";
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
import { footerActions } from "@/lib/poi-sheet-actions";
import { TILE_CLASS } from "@/lib/poi-tile";

const TRAVEL_MODES: RouteMode[] = ["walk", "car", "transit"];

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

/**
 * Страница «Карта» — не карта, а окно в неё. Полотно MapLibre живёт в
 * навигаторе и никуда не переезжает: перенос канваса в другое место DOM
 * заставил бы MapLibre пересоздать контекст, и сбились бы линия маршрута,
 * положение и ведение — ровно то, на что была жалоба. Поэтому окно прозрачно,
 * а непрозрачны только части страницы вокруг него.
 *
 * Окно живёт в двух состояниях. Свёрнутое — плитка в пропорции банковской
 * карты, такая же, как баннер на «Месте»; под ней, на непрозрачном фоне, всё
 * управление маршрутом. Свёрнутая плитка **берёт нажатие на себя**: нажатие на
 * пустое место карты означает «поставь сюда мою булавку», и в окошке размером с
 * кредитку это была бы ловушка. Раскрытое окно событий не берёт — палец
 * достаёт до карты, — поэтому сворачивает его отдельная ручка сверху.
 *
 * `tileRef` отдаётся навигатору: `fitRoute()` вписывает маршрут в прямоугольник
 * окна, каким бы оно сейчас ни было.
 */
export function PoiPaneMap({
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
  t,
}: {
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
  t: StepTranslator;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const actions = footerActions(!!route);
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
          "pointer-events-auto space-y-2 px-4 pt-3 " +
          (docked
            ? "bg-card"
            : expanded
              ? "shrink-0 border-t border-hairline bg-card/95 backdrop-blur"
              : "min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hairline bg-card")
        }
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
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
                {stepsOpen && (
                  <div className="max-h-[32vh] overflow-y-auto overscroll-contain">
                    <StepList steps={route.steps} t={t} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

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
      <div
        ref={tileRef}
        data-testid="poi-map-tile"
        className={
          "relative w-full " +
          (expanded ? "min-h-0 flex-1" : `${TILE_CLASS} shrink-0 border-b border-hairline`)
        }
      >
        {expanded ? (
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
      {controls}
    </div>
  );
}
