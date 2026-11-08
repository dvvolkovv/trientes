import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const IMMUTABLE = "public, max-age=31536000, immutable";

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
    headers: { "Cache-Control": "no-store" },
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

function contentType(filePath: string): string {
  if (filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function serveMapLibreAsset(
  segments: readonly string[] | undefined,
  { root, nodeEnv = process.env.NODE_ENV }: MapLibreAssetOptions = {},
): Response {
  if (
    !segments?.length ||
    segments.some(hasUnsafeSegment) ||
    !isAllowedAssetPath(segments.join("/"), nodeEnv)
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
  } catch {
    return notFound();
  }
}
