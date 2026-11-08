import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as maplibre from "maplibre-gl";
import maplibrePackage from "maplibre-gl/package.json";
import { describe, expect, it } from "vitest";
import {
  copyMapLibreAssets,
  MAPLIBRE_ASSETS,
} from "../scripts/copy-maplibre-worker.mjs";
import { MAPLIBRE_WORKER_URL } from "../src/lib/maplibre-worker";

const root = path.resolve(__dirname, "..");

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("MapLibre 6 runtime and assets", () => {
  it("exposes named ESM exports and configures the installed worker version", () => {
    expect(maplibre.Map).toBeTypeOf("function");
    expect("default" in maplibre).toBe(false);
    expect(MAPLIBRE_WORKER_URL).toBe(
      `/maplibre/${maplibrePackage.version}/maplibre-gl-worker.mjs`,
    );
    expect(maplibre.getWorkerUrl()).toBe(MAPLIBRE_WORKER_URL);
  });

  it.each(MAPLIBRE_ASSETS)("ships an identical local %s asset", (asset) => {
    const publicAsset = path.join(
      root,
      "public/maplibre",
      maplibrePackage.version,
      asset,
    );
    const distributionAsset = path.join(
      root,
      "node_modules/maplibre-gl/dist",
      asset,
    );
    expect(sha256(publicAsset)).toBe(sha256(distributionAsset));
  });

  it("does not rewrite assets whose hashes already match", () => {
    copyMapLibreAssets();
    expect(copyMapLibreAssets().copied).toEqual([]);
  });
});
