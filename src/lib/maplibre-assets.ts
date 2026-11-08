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

// Missing installed-version assets already reported by this process: a broken
// deploy is logged once per path, not once per request.
const reportedMissingAssets = new Set<string>();

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
 * (predev/prebuild, Vitest globalSetup). It is deliberately outside public/:
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

// Logs the code and the allowlisted relative path only: error messages carry
// absolute paths. A missing file is expected for any other version (an old tab,
// a probe) and for source maps, but for a runtime asset of the installed
// version it means the deploy skipped prebuild or runs from another cwd.
function reportReadError(relativePath: string, error: unknown): void {
  const code = errorCode(error);
  if (code !== "ENOENT" && code !== "ENOTDIR") {
    console.error(`[maplibre-assets] cannot serve ${relativePath}: ${code}`);
    return;
  }
  const installedRuntimeAsset = RUNTIME_ASSETS.some(
    (asset) => relativePath === `${INSTALLED_VERSION}/${asset}`,
  );
  if (!installedRuntimeAsset || reportedMissingAssets.has(relativePath)) return;
  reportedMissingAssets.add(relativePath);
  console.error(
    `[maplibre-assets] deployment error: ${ASSET_DIRECTORY}/${relativePath} ` +
      `is missing (${code}); maps cannot start their worker. ${DEPLOY_HINT}.`,
  );
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
