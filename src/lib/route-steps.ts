import type { RouteMode, RouteStep } from "./crypto-map";

/**
 * Turn-by-turn arithmetic, kept free of the DOM and of MapLibre so it can be
 * tested on synthetic routes. The navigator component owns the wording, the
 * banner, and the voice; this module only answers "which maneuver is next,
 * how far is it, and is it time to say something".
 */

/** Distance from the start of the route to the end of each step. */
export function cumulativeEnds(steps: readonly RouteStep[]): number[] {
  let total = 0;
  return steps.map((s) => {
    total += Math.max(0, s.distance);
    return total;
  });
}

export type ActiveStep = { index: number; distanceToManeuver: number };

/**
 * The step being travelled and the distance left to the maneuver that ends it.
 * OSRM puts a step's maneuver at its START, so the one the user is about to
 * perform closes the current step.
 */
export function activeStep(travelledMeters: number, ends: readonly number[]): ActiveStep | null {
  if (ends.length === 0) return null;
  for (let i = 0; i < ends.length; i++) {
    if (ends[i] > travelledMeters) {
      return { index: i, distanceToManeuver: ends[i] - travelledMeters };
    }
  }
  return { index: ends.length - 1, distanceToManeuver: 0 };
}

export type AnnouncementBand = "continue" | "far" | "near" | "now";

// Пороги в метрах — нижняя граница, а не правило. На 90 км/ч тридцать метров
// до поворота это 1,2 секунды: фраза договаривается уже за перекрёстком.
// Поэтому порог — максимум из метров и «скорость × секунды хода».
const BANDS: Record<"walk" | "car", Record<AnnouncementBand, number>> = {
  car: { continue: 1200, far: 400, near: 150, now: 30 },
  walk: { continue: 350, far: 120, near: 50, now: 15 },
};

const SECONDS: Record<AnnouncementBand, number> = { continue: 60, far: 25, near: 10, now: 4 };

const ORDER: AnnouncementBand[] = ["now", "near", "far", "continue"];

/** Which announcement a distance falls into, or null while it is too far to mention. */
export function announcementBand(
  distanceMeters: number,
  mode: RouteMode,
  speedMps = 0,
): AnnouncementBand | null {
  const b = BANDS[mode === "car" ? "car" : "walk"];
  const speed = Math.max(0, speedMps);
  for (const band of ORDER) {
    if (distanceMeters <= Math.max(b[band], speed * SECONDS[band])) return band;
  }
  return null;
}

const BY_MODIFIER: Record<string, string> = {
  left: "turnLeft",
  right: "turnRight",
  "slight left": "turnSlightLeft",
  "slight right": "turnSlightRight",
  "sharp left": "turnSharpLeft",
  "sharp right": "turnSharpRight",
  uturn: "uturn",
};

const SIDE: Record<string, "Left" | "Right"> = {
  left: "Left",
  "slight left": "Left",
  "sharp left": "Left",
  right: "Right",
  "slight right": "Right",
  "sharp right": "Right",
};

/**
 * The i18n key suffix for a maneuver (`cryptoMap.nav.<key>`). Unknown types and
 * modifiers fall back to "continue": saying something generic beats saying
 * nothing to someone who is driving.
 */
export function maneuverKey(step: RouteStep): string {
  const type = step.type.toLowerCase();
  const modifier = step.modifier?.toLowerCase() ?? null;

  switch (type) {
    case "depart":
      return "depart";
    case "arrive":
      return "arrive";
    case "roundabout":
    case "rotary":
    case "roundabout turn":
    case "exit roundabout":
    case "exit rotary":
      return "roundabout";
    case "merge":
      return "merge";
    case "new name":
      return "newName";
    case "on ramp":
      return "onRamp";
    case "off ramp":
      return "offRamp";
    case "fork":
      return modifier && SIDE[modifier] ? `fork${SIDE[modifier]}` : "continue";
    case "end of road":
      return modifier && SIDE[modifier] ? `endOfRoad${SIDE[modifier]}` : "continue";
    default:
      return (modifier && BY_MODIFIER[modifier]) ?? "continue";
  }
}
