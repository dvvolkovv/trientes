"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import type { TransitLeg } from "@/lib/crypto-map";
import { vehicleKey, type TransitCue } from "@/lib/transit-guidance";
import { spokenDistance, shortDistance, type StepTranslator } from "@/components/coin-detail/route-steps-panel";

/**
 * Составной маршрут человеческими словами: нитка поездки до неё и подсказка
 * «что делать сейчас» во время неё.
 *
 * Слова живут здесь, арифметика — в `transit-guidance.ts`. Разделение то же,
 * что у пешего и автомобильного ведения: `route-steps.ts` считает, а
 * `route-steps-panel.tsx` произносит.
 */

const LEG_ICON: Record<string, string> = {
  walk: "🚶",
  metro: "🚇",
  rail: "🚆",
  bus: "🚌",
  tram: "🚊",
  ferry: "⛴️",
  transit: "🚍",
};

export function legIcon(mode: string): string {
  return LEG_ICON[vehicleKey(mode)] ?? "🚍";
}

/**
 * Время ноги; `null` — маршрутизатор его не назвал.
 *
 * Язык берётся у страницы, а не у браузера: живой прогон на русской странице
 * показал «06:12 PM» — часы были отформатированы по настройкам устройства, а
 * человек читает страницу на своём языке.
 */
export function clockTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function vehicleName(leg: TransitLeg, t: StepTranslator): string {
  return t(`nav.transit.vehicle_${vehicleKey(leg.mode)}`);
}

/** «Сядьте на метро A в сторону Nemocnice Motol, платформа 2». */
function boardText(leg: TransitLeg, stop: string | null, t: StepTranslator): string {
  const vehicle = vehicleName(leg, t);
  const line = leg.line ?? "";
  const where = stop ?? leg.from ?? "";
  const phrase = leg.headsign
    ? t("nav.transit.board", { stop: where, vehicle, line, headsign: leg.headsign })
    : t("nav.transit.boardNoHeadsign", { stop: where, vehicle, line });
  return leg.fromTrack ? `${phrase}. ${t("nav.transit.boardTrack", { track: leg.fromTrack })}` : phrase;
}

/**
 * Одна фраза на подсказку — её и слышно, и видно. Два текста (для голоса и для
 * баннера) разошлись бы: человек слышал бы одно, а читал другое.
 */
export function transitCueText(cue: TransitCue, t: StepTranslator): string {
  const distance = spokenDistance(cue.distanceMeters, t);
  switch (cue.kind) {
    case "walk":
      if (cue.transfer && cue.stopName) {
        return t("nav.transit.transferTo", { distance, stop: cue.stopName });
      }
      return cue.stopName
        ? t("nav.transit.walkToStop", { distance, stop: cue.stopName })
        : t("nav.transit.walkToDestination", { distance });
    case "board":
      return cue.nextLeg ? boardText(cue.nextLeg, cue.stopName, t) : t("nav.transit.waitHere");
    case "ride": {
      const ride = t("nav.transit.ride", {
        vehicle: vehicleName(cue.leg, t),
        line: cue.leg.line ?? "",
        stop: cue.stopName ?? "",
      });
      return cue.stopsLeft && cue.stopsLeft > 1
        ? `${ride}. ${t("nav.transit.stopsCount", { count: cue.stopsLeft })}`
        : ride;
    }
    case "alightNext":
      return t("nav.transit.alightNext", { stop: cue.stopName ?? "" });
    case "alight":
      return t("nav.transit.alight", { stop: cue.stopName ?? "" });
  }
}

/** Знак линии: номер на её собственном цвете, как на схеме в вагоне. */
function LineBadge({ leg }: { leg: TransitLeg }) {
  if (!leg.line) return null;
  return (
    <span
      className="num inline-flex min-h-[22px] items-center rounded-md px-1.5 text-[12px] font-semibold text-white"
      style={{ background: leg.color }}
    >
      {leg.line}
    </span>
  );
}

/** Значок подсказки: пешая нога — пешеход, в транспорте — сам транспорт. */
function cueIcon(cue: TransitCue): string {
  if (cue.kind === "walk") return "🚶";
  const leg = cue.kind === "board" ? cue.nextLeg ?? cue.leg : cue.leg;
  return legIcon(leg.mode);
}

/**
 * Подсказка ведения в транспорте — строкой НАД картой, как и манёвр у пешего
 * режима. Правое число меняется по смыслу: пешком это метры до остановки, в
 * вагоне — остановки до выхода, потому что метров там никто не считает.
 */
export function TransitBanner({ cue, t }: { cue: TransitCue; t: StepTranslator }) {
  // Справа — только то, чего нет во фразе. У пешей ноги расстояние уже сказано
  // словами («идите 250 м до Staroměstská»), и повтор цифрой был бы тем же
  // числом дважды; в вагоне метров нет, зато есть остановки.
  const counter =
    cue.kind === "ride" || cue.kind === "alightNext"
      ? t("nav.transit.stopsCount", { count: cue.stopsLeft ?? 1 })
      : null;
  // Цвет линии стоит на знаке номера, а не на значке: значок — эмодзи, и
  // своего цвета он не отдаёт.
  const leg = cue.kind === "board" ? (cue.nextLeg ?? cue.leg) : cue.leg;
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-hairline bg-card px-3 py-2">
      <span aria-hidden className="text-[22px] leading-none">
        {cueIcon(cue)}
      </span>
      {!leg.dashed && <LineBadge leg={leg} />}
      <span className="flex-1 text-[13px] leading-snug text-foreground">{transitCueText(cue, t)}</span>
      {counter && <span className="num shrink-0 text-[13px] text-muted">{counter}</span>}
    </div>
  );
}

const LEVEL_KEY: Record<string, string> = { up: "nav.transit.stairsUp", down: "nav.transit.stairsDown" };

/** Шаг пешей ноги показывается только когда маршрутизатор о нём что-то сказал. */
function walkStepText(
  step: TransitLeg["walkSteps"][number],
  t: StepTranslator,
): string | null {
  if (step.direction === "ELEVATOR") return t("nav.transit.elevator");
  if (step.level) return t(LEVEL_KEY[step.level]);
  if (step.streetName) return t("nav.transit.alongStreet", { name: step.streetName });
  return null;
}

/**
 * Нитка поездки: по ноге на строку, с временем, платформой, направлением и
 * остановками. Это ответ на «сколько мне идти и до чего, где садиться и где
 * выходить» до того, как человек нажал «Поехали».
 */
export function TransitItinerary({ legs, t }: { legs: readonly TransitLeg[]; t: StepTranslator }) {
  const [openStops, setOpenStops] = useState<number | null>(null);
  const locale = useLocale();
  return (
    <ol className="mt-2 space-y-2">
      {legs.map((leg, i) => {
        const from = clockTime(leg.startTime, locale);
        const to = clockTime(leg.endTime, locale);
        const nextLeg = legs[i + 1];
        const target = leg.dashed ? (nextLeg?.from ?? leg.to) : leg.to;
        return (
          <li key={i} className="flex items-start gap-2.5 text-[12px] leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center text-[15px]">
              {legIcon(leg.mode)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {!leg.dashed && <LineBadge leg={leg} />}
                <span className="font-medium text-foreground">
                  {leg.dashed
                    ? target
                      ? t("nav.transit.walkToStop", { distance: shortDistance(leg.meters), stop: target })
                      : t("nav.transit.walkToDestination", { distance: shortDistance(leg.meters) })
                    : t("nav.transit.rideFromTo", { from: leg.from ?? "", to: leg.to ?? "" })}
                </span>
              </div>

              {!leg.dashed && leg.headsign && (
                <div className="text-muted">{t("nav.transit.towards", { headsign: leg.headsign })}</div>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
                {from && to && (
                  <span className="num">
                    {from} → {to}
                  </span>
                )}
                {!leg.realTime && (from || to) && <span className="text-muted/70">{t("nav.transit.scheduled")}</span>}
                {!leg.dashed && leg.fromTrack && (
                  <span>{t("nav.transit.boardTrack", { track: leg.fromTrack })}</span>
                )}
              </div>

              {leg.stops.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenStops((v) => (v === i ? null : i))}
                    aria-expanded={openStops === i}
                    className="flex min-h-[32px] items-center gap-1.5 text-muted hover:text-foreground"
                  >
                    <span aria-hidden>{openStops === i ? "▾" : "▸"}</span>
                    {t("nav.transit.stopsCount", { count: leg.stops.length + 1 })}
                  </button>
                  {openStops === i && (
                    <ul className="space-y-0.5 border-l border-hairline pl-2.5 text-muted">
                      {leg.stops.map((s, k) => (
                        <li key={k} className="flex items-center gap-2">
                          <span className="truncate">{s.name}</span>
                          {clockTime(s.arrival, locale) && <span className="num shrink-0 text-muted/70">{clockTime(s.arrival, locale)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {leg.dashed &&
                leg.walkSteps
                  .map((s) => walkStepText(s, t))
                  .filter((text): text is string => !!text)
                  .slice(0, 6)
                  .map((text, k) => (
                    <div key={k} className="text-muted/80">
                      · {text}
                    </div>
                  ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
