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
import { StepList, type StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { footerActions } from "@/lib/poi-sheet-actions";

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
 * положение и ведение — ровно то, на что была жалоба. Поэтому страница
 * прозрачна и не берёт события, а палец достаёт до карты; события включены
 * только у полосы управления внизу.
 *
 * `barRef` отдаётся навигатору: `fitRoute()` вписывает маршрут в видимую часть
 * карты и меряет для этого настоящую высоту полосы — у транспорта в сводке
 * появляются пересадки, и полоса выше.
 */
export function PoiPaneMap({
  route,
  mode,
  status,
  hasOrigin,
  voiceOn,
  voiceSupported,
  barRef,
  docked,
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
  barRef: RefObject<HTMLDivElement | null>;
  /** На десктопе та же полоса стоит подвалом панели, а не окном поверх карты. */
  docked: boolean;
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

  return (
    <div
      className={
        docked ? "flex flex-col" : "pointer-events-none flex h-full flex-col justify-end"
      }
    >
      <div
        ref={barRef}
        className={
          "pointer-events-auto space-y-2 px-4 pt-3 " +
          (docked ? "bg-card" : "border-t border-hairline bg-card/95 backdrop-blur")
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
    </div>
  );
}
