import { describe, expect, it } from "vitest";
import {
  BASEMAP_PRESET,
  basemapAttribution,
  basemapStyle,
  type BasemapPreset,
} from "@/lib/basemap";

const PRESETS: BasemapPreset[] = ["osm", "openfreemap"];

describe("basemapStyle", () => {
  it("draws the OSM preset from the foundation's own raster tiles", () => {
    const style = basemapStyle("osm");
    expect(typeof style).not.toBe("string");
    const spec = style as Exclude<typeof style, string>;
    const source = spec.sources.osm as { tiles?: string[] };
    expect(source.tiles).toEqual(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
    // Exactly one base layer: the navigator grafts satellite/route/POI layers
    // on top of it and relies on the satellite raster covering the base.
    expect(spec.layers).toHaveLength(1);
  });

  it("keeps the OpenFreeMap preset as a style URL for a one-line rollback", () => {
    expect(basemapStyle("openfreemap")).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("hands every map its own style object", () => {
    expect(basemapStyle("osm")).not.toBe(basemapStyle("osm"));
  });

  it("defaults to the active preset", () => {
    expect(basemapStyle()).toEqual(basemapStyle(BASEMAP_PRESET));
  });
});

describe("basemapAttribution", () => {
  it("credits OpenStreetMap under every preset", () => {
    for (const preset of PRESETS) {
      expect(basemapAttribution(preset)).toContain("© OpenStreetMap contributors");
    }
  });

  // The attribution is a fixed string, so it cannot drift from the tiles on
  // screen by itself — this is the only thing holding the two together.
  it("credits OpenFreeMap only when its tiles are the ones drawn", () => {
    expect(basemapAttribution("openfreemap")).toContain("© OpenFreeMap");
    expect(basemapAttribution("osm")).not.toContain("© OpenFreeMap");
  });

  it("defaults to the active preset", () => {
    expect(basemapAttribution()).toBe(basemapAttribution(BASEMAP_PRESET));
  });
});
