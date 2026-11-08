import { copyMapLibreAssets } from "../scripts/copy-maplibre-worker.mjs";

export default function prepareMapLibreAssets(): void {
  copyMapLibreAssets({
    environment: {
      ...process.env,
      MAPLIBRE_INCLUDE_SOURCE_MAPS: "1",
    },
  });
}
