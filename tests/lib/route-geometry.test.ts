import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  nearestOnLineString,
  remainingMeters,
} from "@/lib/route-geometry";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters([14.42, 50.08], [14.42, 50.08])).toBe(0);
  });

  it("computes Moscow → St. Petersburg as ~635 km (±5 km)", () => {
    const moscow: [number, number] = [37.6173, 55.7558];
    const spb: [number, number] = [30.3351, 59.9343];
    const d = haversineMeters(moscow, spb);
    expect(d).toBeGreaterThan(630_000);
    expect(d).toBeLessThan(640_000);
  });
});

describe("nearestOnLineString", () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];

  it("returns 0 when the point sits exactly on the first vertex", () => {
    const r = nearestOnLineString([0, 0], line);
    expect(r.distance).toBeCloseTo(0, 1);
    expect(r.segmentIndex).toBe(0);
    expect(r.t).toBeCloseTo(0, 5);
  });

  it("projects a point onto the middle of the first segment", () => {
    const r = nearestOnLineString([0.5, 0], line);
    expect(r.distance).toBeLessThan(10);
    expect(r.segmentIndex).toBe(0);
    expect(r.t).toBeCloseTo(0.5, 2);
  });

  it("reports a sensible perpendicular distance for a point off the line", () => {
    const r = nearestOnLineString([0.5, 0.001], line);
    expect(r.distance).toBeGreaterThan(100);
    expect(r.distance).toBeLessThan(115);
    expect(r.segmentIndex).toBe(0);
  });

  it("does not divide by zero on a degenerate segment", () => {
    const degenerate: [number, number][] = [
      [0, 0],
      [0, 0],
      [1, 0],
    ];
    const r = nearestOnLineString([0.5, 0], degenerate);
    expect(Number.isFinite(r.distance)).toBe(true);
    expect(r.distance).toBeLessThan(10);
  });
});

describe("remainingMeters", () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const seg0Len = haversineMeters(line[0], line[1]);
  const seg1Len = haversineMeters(line[1], line[2]);
  const total = seg0Len + seg1Len;

  it("returns 0 at the very end of the line", () => {
    expect(remainingMeters(line, 1, 1)).toBeCloseTo(0, 0);
  });

  it("returns the total length at the very start", () => {
    expect(remainingMeters(line, 0, 0)).toBeCloseTo(total, 0);
  });

  it("returns half of seg0 + all of seg1 from the middle of seg0", () => {
    const got = remainingMeters(line, 0, 0.5);
    expect(got).toBeCloseTo(seg0Len * 0.5 + seg1Len, -1);
  });
});
