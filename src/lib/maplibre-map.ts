import { Map as MlMap, type MapOptions } from "maplibre-gl";
import { supportsWebGL2 } from "./webgl-support";

/**
 * Creates a MapLibre map, or returns `null` when it cannot run here, so the
 * caller can show a fallback instead of the map.
 *
 * Without WebGL2, MapLibre GL 6.4.1 does not throw: it fires an "error" event
 * and returns a half-initialised map (no painter, no handlers) whose later
 * calls — `remove()` included — throw. So: probe WebGL2 first, catch a throwing
 * constructor, and treat a map without a painter as a failure too. The
 * half-initialised map is dropped together with its container, which the
 * callers stop rendering once this returns `null`.
 */
export function tryCreateMap(options: MapOptions): MlMap | null {
  if (!supportsWebGL2()) return null;
  try {
    const map = new MlMap(options);
    // `painter` is a MapLibre internal, not public API: MapLibre >= 6.x creates
    // it synchronously in the constructor and stops right there without a
    // WebGL2 context (map.ts: `if (!this.painter) return;`). The positive
    // contract test "tryCreateMap returns a working map with the real MapLibre
    // bundle" in tests/e2e/maplibre-webgl-fallback.spec.ts pins this down; run
    // it first whenever maplibre-gl is upgraded.
    if (!map.painter) {
      console.warn("[map] MapLibre could not create a WebGL2 context");
      return null;
    }
    return map;
  } catch (error) {
    console.warn("[map] MapLibre failed to initialise", error);
    return null;
  }
}
