import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";

const IMMUTABLE = "public, max-age=31536000, immutable";

const INSTALLED_VERSION = maplibrePackage.version;
const RUNTIME_ASSETS = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
// Only for log messages: the default root, relative to the repository root.
const ASSET_DIRECTORY = ".generated/maplibre";
const DEPLOY_HINT =
  "run `npm run build` in the repository root and start the server from there";

// Read errors already reported by this process, so a broken deploy or a
// repeated probe is logged once rather than once per request. Keys hold only an
// error code and an allowlisted path of the installed version, so the set stays
// small whatever the requests are.
const reportedReadErrors = new Set<string>();

// Codes that mean the asset does not exist: the file or the version directory
// is missing, the version path is a file, or a version segment the allowlist
// accepts is longer than the filesystem allows.
const MISSING_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

// The only files the route may ever read, matched against the joined relative
// path before any filesystem access. Source maps are dev/test-only.
const RUNTIME_ASSET_PATH = /^\d+\.\d+\.\d+\/maplibre-gl-(?:worker|shared)\.mjs$/;
const SOURCE_MAP_ASSET_PATH = /^\d+\.\d+\.\d+\/maplibre-gl-(?:worker|shared)\.mjs\.map$/;

export type MapLibreAssetOptions = {
  /** Directory containing `<version>/<asset>`; defaults to `<cwd>/.generated/maplibre`. */
  root?: string;
  /** Source maps are served only when this is not "production"; defaults to process.env.NODE_ENV. */
  nodeEnv?: string;
};

/**
 * The default root is written by scripts/copy-maplibre-worker.mjs
 * (predev/prebuild, Vitest globalSetup), which names it
 * MAPLIBRE_ASSET_DIRECTORY; keep the literal segments here and ASSET_DIRECTORY
 * above in sync with it. It is deliberately outside public/:
 * Next must never serve these files statically, so this module is the single
 * owner of their headers.
 *
 * Turbopack traces filesystem calls into the server output. The literal
 * segments scope that trace to .generated/maplibre; an injected root (tests
 * only) is opted out, because its unknown value would trace the whole project.
 */
function resolveAssetRoot(root: string | undefined): string {
  return root === undefined
    ? realpathSync(path.join(process.cwd(), ".generated", "maplibre"))
    : realpathSync(/*turbopackIgnore: true*/ root);
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function hasUnsafeSegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return (
    !decoded ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    path.isAbsolute(decoded)
  );
}

function isAllowedAssetPath(relativePath: string, nodeEnv: string | undefined): boolean {
  return (
    RUNTIME_ASSET_PATH.test(relativePath) ||
    (nodeEnv !== "production" && SOURCE_MAP_ASSET_PATH.test(relativePath))
  );
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "unknown error";
}

function reportOnce(key: string, message: string): void {
  if (reportedReadErrors.has(key)) return;
  reportedReadErrors.add(key);
  console.error(message);
}

// Logs the code and at most an allowlisted relative path of the installed
// version: error messages carry absolute paths, and any other version comes
// from the request. A missing file is expected for any other version (an old
// tab, a probe) and for source maps, but for a runtime asset of the installed
// version it means the deploy skipped prebuild or runs from another cwd.
function reportReadError(relativePath: string, error: unknown): void {
  const code = errorCode(error);
  if (MISSING_CODES.has(code)) {
    const installedRuntimeAsset = RUNTIME_ASSETS.some(
      (asset) => relativePath === `${INSTALLED_VERSION}/${asset}`,
    );
    if (!installedRuntimeAsset) return;
    reportOnce(
      `missing ${relativePath}`,
      `[maplibre-assets] deployment error: ${ASSET_DIRECTORY}/${relativePath} ` +
        `is missing (${code}), so maps cannot start their worker: ${DEPLOY_HINT}.`,
    );
    return;
  }
  if (relativePath.startsWith(`${INSTALLED_VERSION}/`)) {
    reportOnce(
      `installed ${code} ${relativePath}`,
      `[maplibre-assets] cannot serve ${relativePath}: ${code}`,
    );
    return;
  }
  reportOnce(
    `other ${code}`,
    `[maplibre-assets] cannot serve an asset of a MapLibre version other than ` +
      `the installed ${INSTALLED_VERSION}: ${code}`,
  );
}

export type MapLibreAssetCheckOptions = {
  /** Directory containing `<version>/<asset>`; defaults to `<cwd>/.generated/maplibre`. */
  root?: string;
  /** Defaults to the installed maplibre-gl version. */
  version?: string;
};

/** Relative `<version>/<asset>` paths of the runtime assets that are not a readable file. */
export function findMissingMapLibreAssets({
  root,
  version = INSTALLED_VERSION,
}: MapLibreAssetCheckOptions = {}): string[] {
  const assetRoot = root ?? path.join(process.cwd(), ".generated", "maplibre");
  return RUNTIME_ASSETS.map((asset) => `${version}/${asset}`).filter(
    (relativePath) => {
      try {
        // Opted out of Turbopack tracing like an injected root: the route
        // already traces the default directory.
        return !statSync(
          path.join(/*turbopackIgnore: true*/ assetRoot, relativePath),
          { throwIfNoEntry: false },
        )?.isFile();
      } catch {
        return true;
      }
    },
  );
}

/**
 * Startup check, called from src/instrumentation.ts: reports a deploy that
 * skipped prebuild or a server started outside the repository root before the
 * first map fails. Never throws, so it can never stop the server.
 *
 * @returns whether every runtime asset of the version is present.
 */
export function checkMapLibreAssets(
  options: MapLibreAssetCheckOptions = {},
): boolean {
  try {
    const missing = findMissingMapLibreAssets(options);
    if (missing.length === 0) return true;
    console.error(
      `[maplibre-assets] DEPLOYMENT ERROR: missing ` +
        missing.map((relativePath) => `${ASSET_DIRECTORY}/${relativePath}`).join(", ") +
        `. Maps cannot start their worker until this is fixed: ${DEPLOY_HINT}.`,
    );
  } catch (error) {
    console.error(`[maplibre-assets] startup check failed: ${errorCode(error)}`);
  }
  return false;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function serveMapLibreAsset(
  segments: readonly string[] | undefined,
  { root, nodeEnv = process.env.NODE_ENV }: MapLibreAssetOptions = {},
): Response {
  const relativePath = segments?.join("/") ?? "";
  if (
    !segments?.length ||
    segments.some(hasUnsafeSegment) ||
    !isAllowedAssetPath(relativePath, nodeEnv)
  ) {
    return notFound();
  }

  try {
    const realRoot = resolveAssetRoot(root);
    const candidate = realpathSync(path.join(realRoot, ...segments));
    const relative = path.relative(realRoot, candidate);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !statSync(candidate).isFile()
    ) {
      return notFound();
    }

    const body = readFileSync(candidate);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Cache-Control": IMMUTABLE,
        "Content-Type": contentType(candidate),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    reportReadError(relativePath, error);
    return notFound();
  }
}
