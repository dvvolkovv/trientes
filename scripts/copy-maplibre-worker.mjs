import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAPLIBRE_ASSETS = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker.mjs.map",
  "maplibre-gl-shared.mjs.map",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "node_modules/maplibre-gl/dist");
const packagePath = path.join(root, "node_modules/maplibre-gl/package.json");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function copyMapLibreAssets() {
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const targetDirectory = path.join(root, "public/maplibre", version);
  const copied = [];

  mkdirSync(targetDirectory, { recursive: true });
  for (const asset of MAPLIBRE_ASSETS) {
    const source = path.join(sourceDirectory, asset);
    const destination = path.join(targetDirectory, asset);
    if (existsSync(destination) && sha256(source) === sha256(destination)) {
      continue;
    }
    copyFileSync(source, destination);
    copied.push(asset);
  }

  return { version, targetDirectory, copied };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyMapLibreAssets();
}
