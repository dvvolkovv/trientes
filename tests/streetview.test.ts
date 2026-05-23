import { describe, expect, it } from "vitest";
import {
  bboxAround,
  haversineMeters,
  parseMapillaryImages,
  parsePanoramax,
  sortByDistance,
  spaceByDistance,
} from "@/lib/streetview";

describe("bboxAround", () => {
  it("expands a point by the given radius in degrees", () => {
    // 111320 m ≈ 1° of latitude; at the equator cos(0)=1 so longitude matches.
    const b = bboxAround(0, 0, 111320);
    expect(b.minLat).toBeCloseTo(-1, 4);
    expect(b.maxLat).toBeCloseTo(1, 4);
    expect(b.minLon).toBeCloseTo(-1, 4);
    expect(b.maxLon).toBeCloseTo(1, 4);
  });

  it("widens longitude with latitude (cos factor)", () => {
    const b = bboxAround(60, 30, 111320);
    // cos(60°) = 0.5 → longitude span doubles
    expect(b.maxLon - 30).toBeCloseTo(2, 2);
    expect(b.maxLat - 60).toBeCloseTo(1, 4);
  });
});

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(50, 14, 50, 14)).toBe(0);
  });

  it("matches ~111 km for one degree of longitude at the equator", () => {
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("parseMapillaryImages", () => {
  it("normalizes the data array into StreetShots", () => {
    const shots = parseMapillaryImages({
      data: [
        {
          id: "1",
          geometry: { type: "Point", coordinates: [13.4, 52.5] },
          captured_at: 1707983479000,
          compass_angle: 90,
          thumb_1024_url: "https://m/1.jpg",
          sequence: "s1",
        },
      ],
    });
    expect(shots).toEqual([
      { id: "1", lat: 52.5, lon: 13.4, thumb: "https://m/1.jpg", capturedAt: 1707983479000, bearing: 90, source: "mapillary" },
    ]);
  });

  it("skips images without a thumbnail or coordinates", () => {
    const shots = parseMapillaryImages({
      data: [
        { id: "2", geometry: { type: "Point", coordinates: [1, 2] } }, // no thumb
        { id: "3", thumb_1024_url: "https://m/3.jpg" }, // no geometry
      ],
    });
    expect(shots).toEqual([]);
  });

  it("returns [] on a malformed payload", () => {
    expect(parseMapillaryImages(null)).toEqual([]);
    expect(parseMapillaryImages({})).toEqual([]);
  });
});

describe("parsePanoramax", () => {
  it("normalizes STAC features, preferring the sd asset", () => {
    const shots = parsePanoramax({
      features: [
        {
          id: "a",
          geometry: { type: "Point", coordinates: [2.34, 48.86] },
          properties: { datetime: "2024-11-03T15:21:28.935690+00:00", "view:azimuth": 98 },
          assets: { hd: { href: "https://p/hd.jpg" }, sd: { href: "https://p/sd.jpg" }, thumb: { href: "https://p/t.jpg" } },
        },
      ],
    });
    expect(shots).toEqual([
      {
        id: "a",
        lat: 48.86,
        lon: 2.34,
        thumb: "https://p/sd.jpg",
        capturedAt: Date.parse("2024-11-03T15:21:28.935690+00:00"),
        bearing: 98,
        source: "panoramax",
      },
    ]);
  });

  it("falls back to thumb then hd when sd is absent", () => {
    const onlyThumb = parsePanoramax({
      features: [{ id: "b", geometry: { type: "Point", coordinates: [1, 2] }, properties: {}, assets: { thumb: { href: "https://p/t.jpg" } } }],
    });
    expect(onlyThumb[0].thumb).toBe("https://p/t.jpg");
    expect(onlyThumb[0].capturedAt).toBeNull();
    expect(onlyThumb[0].bearing).toBeNull();
  });

  it("skips features without any image asset and returns [] on garbage", () => {
    expect(parsePanoramax({ features: [{ id: "c", geometry: { type: "Point", coordinates: [1, 2] }, properties: {}, assets: {} }] })).toEqual([]);
    expect(parsePanoramax(null)).toEqual([]);
  });
});

describe("sortByDistance", () => {
  it("orders shots nearest-first and attaches distanceM", () => {
    const far = { id: "far", lat: 0.01, lon: 0, thumb: "x", capturedAt: null, bearing: null, source: "panoramax" as const };
    const near = { id: "near", lat: 0.0001, lon: 0, thumb: "y", capturedAt: null, bearing: null, source: "panoramax" as const };
    const out = sortByDistance([far, near], 0, 0);
    expect(out.map((s) => s.id)).toEqual(["near", "far"]);
    expect(out[0].distanceM).toBeGreaterThanOrEqual(0);
    expect(out[1].distanceM).toBeGreaterThan(out[0].distanceM);
  });
});

describe("spaceByDistance", () => {
  const mk = (d: number, id: string) => ({
    id,
    lat: 0,
    lon: 0,
    thumb: "x",
    capturedAt: null,
    bearing: null,
    source: "panoramax" as const,
    distanceM: d,
  });

  it("drops near-duplicate frames, keeping ~one per gap", () => {
    const out = spaceByDistance(
      [mk(5, "a"), mk(6, "b"), mk(7, "c"), mk(20, "d"), mk(25, "e"), mk(40, "f")],
      8,
    );
    expect(out.map((s) => s.id)).toEqual(["a", "d", "f"]);
  });

  it("returns [] for an empty list", () => {
    expect(spaceByDistance([], 8)).toEqual([]);
  });
});
