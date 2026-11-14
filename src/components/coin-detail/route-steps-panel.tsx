"use client";

import type { RouteStep } from "@/lib/crypto-map";
import { maneuverKey } from "@/lib/route-steps";

export type StepTranslator = (key: string, values?: Record<string, string | number>) => string;

// One glyph per maneuver key; anything unmapped falls back with the key itself.
const ARROW: Record<string, string> = {
  depart: "▲",
  arrive: "⚑",
  turnLeft: "←",
  turnRight: "→",
  turnSlightLeft: "↖",
  turnSlightRight: "↗",
  turnSharpLeft: "↰",
  turnSharpRight: "↱",
  uturn: "↩",
  roundabout: "⟳",
  merge: "⤵",
  newName: "↑",
  onRamp: "⤴",
  offRamp: "⤵",
  forkLeft: "↖",
  forkRight: "↗",
  endOfRoadLeft: "←",
  endOfRoadRight: "→",
  continue: "↑",
};

export function maneuverArrow(step: RouteStep): string {
  return ARROW[maneuverKey(step)] ?? "↑";
}

/** "Turn left onto Dlouhá" — the phrase and the street are separate keys on purpose. */
export function maneuverText(step: RouteStep, t: StepTranslator): string {
  const key = maneuverKey(step);
  const phrase =
    key === "roundabout" && step.exit ? t("nav.roundaboutExit", { exit: step.exit }) : t(`nav.${key}`);
  // "You have arrived onto Dlouhá" is nonsense; every other maneuver reads well with the street.
  if (!step.name || key === "arrive") return phrase;
  return `${phrase} ${t("nav.onto", { name: step.name })}`;
}

/** Spoken distance; rounded the way a driver hears it, not the way a GPS stores it. */
export function spokenDistance(meters: number, t: StepTranslator): string {
  if (meters >= 1000) return t("nav.kilometers", { n: (meters / 1000).toFixed(1) });
  const rounded = meters >= 100 ? Math.round(meters / 50) * 50 : Math.round(meters / 10) * 10;
  return t("nav.meters", { n: Math.max(10, rounded) });
}

export function shortDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

/** The maneuver banner shown while navigation is running. */
export function ManeuverBanner({
  step,
  distanceMeters,
  t,
}: {
  step: RouteStep;
  distanceMeters: number;
  t: StepTranslator;
}) {
  return (
    <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-3 rounded-[14px] border border-hairline bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      <span aria-hidden className="text-[22px] leading-none text-accent">
        {maneuverArrow(step)}
      </span>
      <span className="flex-1 text-[13px] leading-snug text-foreground">{maneuverText(step, t)}</span>
      <span className="num text-[13px] text-muted">{shortDistance(distanceMeters)}</span>
    </div>
  );
}

/** The full list of maneuvers under the route summary. */
export function StepList({ steps, t }: { steps: RouteStep[]; t: StepTranslator }) {
  return (
    <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
          <span aria-hidden className="w-4 shrink-0 text-center text-muted">
            {maneuverArrow(s)}
          </span>
          <span className="flex-1 text-foreground">{maneuverText(s, t)}</span>
          {s.distance > 0 && <span className="num shrink-0 text-muted">{shortDistance(s.distance)}</span>}
        </li>
      ))}
    </ol>
  );
}
