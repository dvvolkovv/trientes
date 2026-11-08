import { copyMapLibreAssets } from "../scripts/copy-maplibre-worker.mjs";

// Copies without pruning: on the production checkout the running server may
// still serve a version directory this copy would otherwise remove.
export default function prepareMapLibreAssets(): void {
  copyMapLibreAssets({
    environment: {
      ...process.env,
      MAPLIBRE_INCLUDE_SOURCE_MAPS: "1",
    },
  });
}
