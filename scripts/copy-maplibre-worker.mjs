import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "node_modules/maplibre-gl/dist");
const targetDirectory = path.join(root, "public/maplibre");
const assets = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(targetDirectory, { recursive: true });
for (const asset of assets) {
  copyFileSync(
    path.join(sourceDirectory, asset),
    path.join(targetDirectory, asset),
  );
}
