import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAPLIBRE_RUNTIME_ASSETS = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];
export const MAPLIBRE_SOURCE_MAP_ASSETS = [
  "maplibre-gl-worker.mjs.map",
  "maplibre-gl-shared.mjs.map",
];
export const MAPLIBRE_ASSETS = [
  ...MAPLIBRE_RUNTIME_ASSETS,
  ...MAPLIBRE_SOURCE_MAP_ASSETS,
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function includeSourceMapsFor(environment) {
  if (environment.MAPLIBRE_INCLUDE_SOURCE_MAPS === "1") return true;
  if (environment.MAPLIBRE_INCLUDE_SOURCE_MAPS === "0") return false;
  return environment.NODE_ENV === "development";
}

function preserveSourceTimes(filePath, sourceStat) {
  utimesSync(filePath, sourceStat.atimeMs / 1000, sourceStat.mtimeMs / 1000);
}

function atomicCopy(source, destination, sourceStat) {
  const directory = path.dirname(destination);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    copyFileSync(source, temporary);
    preserveSourceTimes(temporary, sourceStat);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function syncAsset(source, destination, getSourceHash) {
  const sourceStat = statSync(source);
  let destinationStat;
  try {
    destinationStat = statSync(destination);
  } catch {
    // A missing destination is copied without hashing the source.
  }

  if (
    destinationStat?.isFile() &&
    destinationStat.size === sourceStat.size &&
    Math.abs(destinationStat.mtimeMs - sourceStat.mtimeMs) < 1
  ) {
    return;
  }

  if (destinationStat?.isFile() && destinationStat.size === sourceStat.size) {
    if (getSourceHash() === sha256(destination)) {
      preserveSourceTimes(destination, sourceStat);
      return;
    }
  }

  atomicCopy(source, destination, sourceStat);
}

function stableVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

function isOlderStableVersion(candidate, current) {
  const left = stableVersion(candidate);
  const right = stableVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function removeOlderVersionDirectories(targetRoot, currentVersion) {
  for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      isOlderStableVersion(entry.name, currentVersion)
    ) {
      rmSync(path.join(targetRoot, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}

/** @param {{ rootDirectory?: string, environment?: Record<string, string | undefined> }} [options] */
export function copyMapLibreAssets({
  rootDirectory = root,
  environment = process.env,
} = {}) {
  const packagePath = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/package.json",
  );
  const sourceDirectory = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/dist",
  );
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!stableVersion(version)) {
    throw new Error(`Unsupported MapLibre version: ${version}`);
  }

  const targetRoot = path.join(rootDirectory, "public/maplibre");
  const targetVersion = path.join(targetRoot, version);
  mkdirSync(targetVersion, { recursive: true });

  const includeSourceMaps = includeSourceMapsFor(environment);
  const assets = includeSourceMaps
    ? MAPLIBRE_ASSETS
    : MAPLIBRE_RUNTIME_ASSETS;

  for (const asset of assets) {
    const source = path.join(sourceDirectory, asset);
    let sourceHash;
    const getSourceHash = () => {
      sourceHash ??= sha256(source);
      return sourceHash;
    };

    syncAsset(source, path.join(targetVersion, asset), getSourceHash);
    if (MAPLIBRE_RUNTIME_ASSETS.includes(asset)) {
      // Keep already-open tabs working across a versioned deployment. These two
      // compatibility files are never removed by old-version directory cleanup.
      syncAsset(source, path.join(targetRoot, asset), getSourceHash);
    }
  }

  if (!includeSourceMaps) {
    for (const asset of MAPLIBRE_SOURCE_MAP_ASSETS) {
      rmSync(path.join(targetVersion, asset), { force: true });
    }
  }

  removeOlderVersionDirectories(targetRoot, version);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  copyMapLibreAssets();
}
