import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
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

// Served by src/app/maplibre/[...path]/route.ts. Kept outside public/ so Next
// never serves these files statically: the route alone owns their cache policy.
// src/lib/maplibre-assets.ts spells the same directory as literal path segments
// (they keep Turbopack's file trace scoped to it); keep both in sync.
export const MAPLIBRE_ASSET_DIRECTORY = ".generated/maplibre";
// Written by earlier revisions of this script; its generated files are removed
// by a pruning copy so a stale public copy can never shadow the route.
const LEGACY_PUBLIC_DIRECTORY = "public/maplibre";
// The files those revisions generated there, at the directory root or in a
// <x.y.z>/ subdirectory: MapLibre worker, shared and CSP worker bundles with
// their source maps, and orphaned atomicCopy temporaries. Anything else in
// public/maplibre is not ours and is left alone.
const LEGACY_GENERATED_FILE =
  /^(?:maplibre-gl-(?:csp-worker|worker|shared)[\w.-]*\.m?js(?:\.map)?|\.maplibre-gl-[\w.-]+\.tmp)$/;
// Every MapLibre source map a dev/test copy can leave in a version directory.
const SOURCE_MAP_FILE = /^maplibre-gl-[\w.-]*\.mjs\.map$/;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Leftovers of an atomicCopy interrupted by a crash or a kill. Younger ones may
// still belong to a parallel run and are left alone.
const TEMPORARY_FILE = /^\..+\.tmp$/;
const STALE_TEMPORARY_FILE_AGE_MS = 5 * 60 * 1000;

export class MapLibreNotInstalledError extends Error {
  constructor() {
    super("maplibre-gl is not installed; run npm install");
    this.name = "MapLibreNotInstalledError";
  }
}

function readInstalledVersion(packagePath) {
  let packageJson;
  try {
    packageJson = readFileSync(packagePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new MapLibreNotInstalledError();
    throw error;
  }
  return JSON.parse(packageJson).version;
}

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

// Best effort. Age is taken from ctime, not mtime: atomicCopy backdates the
// temporary file's mtime to the source mtime before renaming it.
function removeStaleTemporaryFiles(directory, now) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !TEMPORARY_FILE.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    try {
      if (now - lstatSync(filePath).ctimeMs > STALE_TEMPORARY_FILE_AGE_MS) {
        rmSync(filePath, { force: true });
      }
    } catch {
      // Already renamed or removed by a parallel run.
    }
  }
}

function syncAsset(source, destination) {
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
    if (sha256(source) === sha256(destination)) {
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

function compareStableVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// Retains the current version plus the newest older stable version: a tab that
// loaded the page before a deployment still requests the previous version's
// worker URL. Older stable versions are removed. Newer versions (a rollback)
// and directories that are not a plain x.y.z version are never touched.
function removeStaleVersionDirectories(targetRoot, currentVersion) {
  const current = stableVersion(currentVersion);
  const older = readdirSync(targetRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, version: stableVersion(entry.name) }))
    .filter(({ version }) => version && compareStableVersions(version, current) < 0)
    .sort((left, right) => compareStableVersions(right.version, left.version));

  for (const { name } of older.slice(1)) {
    rmSync(path.join(targetRoot, name), { recursive: true, force: true });
  }
}

// A copy without source maps drops whatever a dev/test copy left in the
// version directory. Only real files directly inside it: a symlink is neither
// followed nor removed.
function removeSourceMaps(targetVersion) {
  for (const entry of readdirSync(targetVersion, { withFileTypes: true })) {
    if (entry.isFile() && SOURCE_MAP_FILE.test(entry.name)) {
      rmSync(path.join(targetVersion, entry.name), { force: true });
    }
  }
}

// Builds run without source maps, and the production seal check expects no
// .map file in the tree afterwards. A dev/test copy of an earlier version (now
// retained as N-1) or of a newer one (kept for a rollback) can have left maps
// there, so a pruning build drops them in every real stable-version directory.
function removeRetainedSourceMaps(targetRoot) {
  for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && stableVersion(entry.name)) {
      removeSourceMaps(path.join(targetRoot, entry.name));
    }
  }
}

function isRealDirectory(directory) {
  try {
    return lstatSync(directory).isDirectory();
  } catch {
    return false;
  }
}

// Removes the generated files of one directory, then the directory if that
// left it empty. Never recursive: foreign files and directories survive.
function removeGeneratedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && LEGACY_GENERATED_FILE.test(entry.name)) {
      rmSync(path.join(directory, entry.name), { force: true });
    }
  }
  if (readdirSync(directory).length === 0) rmdirSync(directory);
}

function removeLegacyPublicFiles(rootDirectory) {
  const legacyRoot = path.join(rootDirectory, LEGACY_PUBLIC_DIRECTORY);
  if (!isRealDirectory(legacyRoot)) return;
  for (const entry of readdirSync(legacyRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && stableVersion(entry.name)) {
      removeGeneratedFiles(path.join(legacyRoot, entry.name));
    }
  }
  removeGeneratedFiles(legacyRoot);
}

/**
 * Copies the installed MapLibre worker assets into .generated/maplibre/<version>.
 *
 * `prune` also deletes: older version directories beyond N-1, the files
 * earlier revisions generated in public/maplibre and, in a copy without source
 * maps, the source maps of every retained version. Only prebuild prunes. The
 * production checkout doubles as a working copy, so dev and test runs there
 * must never delete the directory of the version the running server serves.
 *
 * @param {{ rootDirectory?: string, environment?: Record<string, string | undefined>, prune?: boolean }} [options]
 */
export function copyMapLibreAssets({
  rootDirectory = root,
  environment = process.env,
  prune = false,
} = {}) {
  const packagePath = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/package.json",
  );
  const sourceDirectory = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/dist",
  );
  const version = readInstalledVersion(packagePath);
  if (!stableVersion(version)) {
    throw new Error(`Unsupported MapLibre version: ${version}`);
  }

  const targetRoot = path.join(rootDirectory, MAPLIBRE_ASSET_DIRECTORY);
  const targetVersion = path.join(targetRoot, version);
  mkdirSync(targetVersion, { recursive: true });
  const now = Date.now();
  for (const directory of [targetRoot, targetVersion]) {
    removeStaleTemporaryFiles(directory, now);
  }

  const includeSourceMaps = includeSourceMapsFor(environment);
  const assets = includeSourceMaps
    ? MAPLIBRE_ASSETS
    : MAPLIBRE_RUNTIME_ASSETS;

  for (const asset of assets) {
    syncAsset(
      path.join(sourceDirectory, asset),
      path.join(targetVersion, asset),
    );
  }

  if (!includeSourceMaps) removeSourceMaps(targetVersion);

  // Only after every asset was copied successfully.
  if (prune) {
    removeStaleVersionDirectories(targetRoot, version);
    if (!includeSourceMaps) removeRetainedSourceMaps(targetRoot);
    removeLegacyPublicFiles(rootDirectory);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    // A command-line flag rather than an environment variable: an exported
    // variable would leak into predev and into Vitest globalSetup, which pass
    // process.env through, and turn their copies into deleting ones.
    copyMapLibreAssets({ prune: process.argv.slice(2).includes("--prune") });
  } catch (error) {
    // An expected setup problem: a one-line hint instead of a raw stack.
    if (!(error instanceof MapLibreNotInstalledError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
