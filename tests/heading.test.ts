import { describe, expect, it } from "vitest";
import {
  HEADING_MIN_SPEED_MPS,
  compassHeadingFrom,
  headingChanged,
  headingDelta,
  normalizeHeading,
  pickHeading,
} from "@/lib/heading";
import { compassLabelKeys, compassTap, isStraight } from "@/lib/compass-mode";

describe("normalizeHeading", () => {
  it("brings any angle into [0,360)", () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(359.9)).toBeCloseTo(359.9);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(450)).toBe(90);
  });

  it("refuses everything that is not a number", () => {
    expect(normalizeHeading(null)).toBeNull();
    expect(normalizeHeading(undefined)).toBeNull();
    expect(normalizeHeading(Number.NaN)).toBeNull();
    expect(normalizeHeading(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("headingDelta", () => {
  it("measures the short way round, not the long one", () => {
    expect(headingDelta(10, 350)).toBe(20);
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(0, 180)).toBe(180);
    expect(headingDelta(90, 90)).toBe(0);
  });
});

describe("pickHeading", () => {
  it("trusts the GPS course while moving", () => {
    expect(pickHeading({ gpsHeading: 120, speedMps: 5, compassHeading: 300 })).toBe(120);
  });

  it("falls back to the phone compass while standing still", () => {
    // Стоящему GPS отдаёт прошлый курс — он и есть «еду назад» на карте.
    expect(pickHeading({ gpsHeading: 120, speedMps: 0, compassHeading: 300 })).toBe(300);
    expect(pickHeading({ gpsHeading: 120, speedMps: HEADING_MIN_SPEED_MPS - 0.01, compassHeading: 300 })).toBe(
      300,
    );
  });

  it("takes the GPS course when the browser hides the speed", () => {
    expect(pickHeading({ gpsHeading: 45, speedMps: null, compassHeading: null })).toBe(45);
  });

  it("uses the GPS course of a standing user when there is no compass at all", () => {
    expect(pickHeading({ gpsHeading: 45, speedMps: 0, compassHeading: null })).toBe(45);
  });

  it("gives nothing when neither source says anything", () => {
    expect(pickHeading({ gpsHeading: null, speedMps: 3, compassHeading: undefined })).toBeNull();
  });
});

describe("headingChanged", () => {
  it("accepts the first course and ignores sensor jitter afterwards", () => {
    expect(headingChanged(null, 10)).toBe(true);
    expect(headingChanged(10, 11)).toBe(false);
    expect(headingChanged(10, 14)).toBe(true);
  });

  it("measures jitter across the north seam", () => {
    expect(headingChanged(359, 1)).toBe(false);
    expect(headingChanged(359, 10)).toBe(true);
  });

  it("never moves the map on a missing course", () => {
    expect(headingChanged(10, null)).toBe(false);
  });
});

describe("compassHeadingFrom", () => {
  it("takes the iOS compass heading as is", () => {
    expect(compassHeadingFrom({ webkitCompassHeading: 42, alpha: 7, absolute: false })).toBe(42);
  });

  it("turns absolute alpha round, because alpha counts the other way", () => {
    expect(compassHeadingFrom({ alpha: 90, absolute: true })).toBe(270);
    expect(compassHeadingFrom({ alpha: 0, absolute: true })).toBe(0);
  });

  it("refuses relative orientation: its zero is not north", () => {
    expect(compassHeadingFrom({ alpha: 90, absolute: false })).toBeNull();
    expect(compassHeadingFrom({ alpha: 90 })).toBeNull();
  });
});

describe("compassTap", () => {
  it("straightens a map turned by fingers instead of starting to follow", () => {
    expect(compassTap({ mode: "north", bearing: 40, pitch: 0 })).toEqual({
      mode: "north",
      straighten: true,
    });
    expect(compassTap({ mode: "north", bearing: 0, pitch: 55 })).toEqual({
      mode: "north",
      straighten: true,
    });
  });

  it("starts following the course once the map is already straight", () => {
    expect(compassTap({ mode: "north", bearing: 0, pitch: 0 })).toEqual({
      mode: "heading",
      straighten: false,
    });
  });

  it("stops following and puts north back up", () => {
    expect(compassTap({ mode: "heading", bearing: 123, pitch: 0 })).toEqual({
      mode: "north",
      straighten: true,
    });
  });

  it("always reaches the following mode in at most two taps", () => {
    let state = { mode: "north" as const, bearing: 123, pitch: 60 };
    const first = compassTap(state);
    const second = compassTap({ mode: first.mode, bearing: 0, pitch: 0 });
    expect(second.mode).toBe("heading");
    expect(state.bearing).toBe(123);
  });
});

describe("isStraight", () => {
  it("calls a map straight only when neither turned nor tilted", () => {
    expect(isStraight({ bearing: 0, pitch: 0 })).toBe(true);
    expect(isStraight({ bearing: -0.2, pitch: 0.1 })).toBe(true);
    expect(isStraight({ bearing: 5, pitch: 0 })).toBe(false);
    expect(isStraight({ bearing: 0, pitch: 5 })).toBe(false);
  });
});

describe("compassLabelKeys", () => {
  it("never shows the same label in both modes", () => {
    const north = compassLabelKeys({ mode: "north", straight: true });
    const heading = compassLabelKeys({ mode: "heading", straight: false });
    expect(north.aria).not.toBe(heading.aria);
    expect(north.short).not.toBe(heading.short);
  });

  it("promises straightening only while there is something to straighten", () => {
    expect(compassLabelKeys({ mode: "north", straight: false }).aria).toBe("resetNorth");
    expect(compassLabelKeys({ mode: "north", straight: true }).aria).toBe("headingUpOn");
  });
});
