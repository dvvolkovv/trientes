import { describe, expect, it } from "vitest";
import {
  activeStep,
  announcementBand,
  cumulativeEnds,
  maneuverKey,
} from "@/lib/route-steps";
import type { RouteStep } from "@/lib/crypto-map";

function step(partial: Partial<RouteStep>): RouteStep {
  return {
    type: "turn",
    modifier: null,
    name: null,
    distance: 100,
    exit: null,
    location: [0, 0],
    ...partial,
  };
}

describe("cumulativeEnds", () => {
  it("measures each step's end from the start of the route", () => {
    const steps = [step({ distance: 120 }), step({ distance: 300 }), step({ distance: 0 })];
    expect(cumulativeEnds(steps)).toEqual([120, 420, 420]);
  });

  it("handles an empty route", () => {
    expect(cumulativeEnds([])).toEqual([]);
  });
});

describe("activeStep", () => {
  const ends = [120, 420, 420];

  it("reports the step being walked and the distance left to its maneuver", () => {
    // The maneuver sits at the START of a step, so what the driver needs is the
    // distance to the END of the one they are on.
    expect(activeStep(0, ends)).toEqual({ index: 0, distanceToManeuver: 120 });
    expect(activeStep(50, ends)).toEqual({ index: 0, distanceToManeuver: 70 });
  });

  it("moves to the next step exactly on the boundary", () => {
    expect(activeStep(120, ends)).toEqual({ index: 1, distanceToManeuver: 300 });
  });

  it("clamps past the end of the route to the last step", () => {
    expect(activeStep(999, ends)).toEqual({ index: 2, distanceToManeuver: 0 });
  });

  it("returns nothing for a route without steps", () => {
    expect(activeStep(10, [])).toBeNull();
  });
});

describe("announcementBand", () => {
  it("announces a car maneuver farther out than a walking one", () => {
    expect(announcementBand(380, "car")).toBe("far");
    expect(announcementBand(380, "walk")).toBeNull();
    expect(announcementBand(100, "walk")).toBe("far");
  });

  it("tightens as the maneuver approaches", () => {
    expect(announcementBand(140, "car")).toBe("near");
    expect(announcementBand(20, "car")).toBe("now");
    expect(announcementBand(40, "walk")).toBe("near");
    expect(announcementBand(10, "walk")).toBe("now");
  });

  it("stays silent beyond the farthest band", () => {
    expect(announcementBand(1200, "car")).toBeNull();
    expect(announcementBand(500, "walk")).toBeNull();
  });
});

describe("maneuverKey", () => {
  it("names turns by their modifier", () => {
    expect(maneuverKey(step({ type: "turn", modifier: "left" }))).toBe("turnLeft");
    expect(maneuverKey(step({ type: "turn", modifier: "slight right" }))).toBe("turnSlightRight");
    expect(maneuverKey(step({ type: "turn", modifier: "sharp left" }))).toBe("turnSharpLeft");
    expect(maneuverKey(step({ type: "turn", modifier: "uturn" }))).toBe("uturn");
  });

  it("names the maneuvers that do not depend on a modifier", () => {
    expect(maneuverKey(step({ type: "depart" }))).toBe("depart");
    expect(maneuverKey(step({ type: "arrive" }))).toBe("arrive");
    expect(maneuverKey(step({ type: "roundabout", exit: 2 }))).toBe("roundabout");
    expect(maneuverKey(step({ type: "rotary", exit: 1 }))).toBe("roundabout");
    expect(maneuverKey(step({ type: "merge", modifier: "left" }))).toBe("merge");
    expect(maneuverKey(step({ type: "new name" }))).toBe("newName");
    expect(maneuverKey(step({ type: "on ramp" }))).toBe("onRamp");
    expect(maneuverKey(step({ type: "off ramp" }))).toBe("offRamp");
  });

  it("splits the maneuvers that only have a side", () => {
    expect(maneuverKey(step({ type: "fork", modifier: "right" }))).toBe("forkRight");
    expect(maneuverKey(step({ type: "end of road", modifier: "left" }))).toBe("endOfRoadLeft");
  });

  // Silence is worse than a generic phrase: an unknown maneuver still has to
  // say something while the driver is moving.
  it("falls back to 'continue' for anything unknown", () => {
    expect(maneuverKey(step({ type: "notifications", modifier: null }))).toBe("continue");
    expect(maneuverKey(step({ type: "turn", modifier: "straight" }))).toBe("continue");
    expect(maneuverKey(step({ type: "fork", modifier: null }))).toBe("continue");
  });
});
