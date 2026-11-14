import type { StyleSpecification } from "maplibre-gl";

export type BasemapPreset = "osm" | "openfreemap";

/**
 * Which base map the Crypto Navigator and the point form draw.
 *
 * "osm" are the raster tiles of openstreetmap.org itself — the look the owner
 * asked for. They come from the OSM Foundation's free servers, whose usage
 * policy allows only light use and gives no guarantee: if they ever block us,
 * flipping this one value back to "openfreemap" restores a key-less vector
 * base built from the same OSM data.
 */
export const BASEMAP_PRESET: BasemapPreset = "osm";

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * Tiles are requested by the visitor's browser, never proxied through us: a
 * proxy would funnel the whole site's tiles through one IP and strip the
 * per-visitor shape of the traffic, which is what their policy calls heavy
 * use. Browsers honour the tiles' own cache headers.
 */
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * A style for one map. MapLibre takes ownership of the object it is given, so
 * every call builds a fresh one rather than sharing a module-level constant.
 */
export function basemapStyle(preset: BasemapPreset = BASEMAP_PRESET): StyleSpecification | string {
  if (preset === "openfreemap") return OPENFREEMAP_STYLE_URL;
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

/** Base-map half of the fixed attribution line; the satellite credit is added by the control. */
export function basemapAttribution(preset: BasemapPreset = BASEMAP_PRESET): string {
  return preset === "openfreemap" ? `${OSM_ATTRIBUTION} | © OpenFreeMap` : OSM_ATTRIBUTION;
}
