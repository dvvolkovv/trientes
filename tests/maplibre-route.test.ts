import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/maplibre/[...path]/route";
import { serveMapLibreAsset } from "../src/lib/maplibre-assets";

const root = path.resolve(__dirname, "..");
const version = maplibrePackage.version;
const IMMUTABLE = "public, max-age=31536000, immutable";
const temporaryRoots: string[] = [];

function requestAsset(segments: string[]): Promise<Response> {
  return GET(new Request(`http://localhost/maplibre/${segments.join("/")}`), {
    params: Promise.resolve({ path: segments }),
  });
}

/** Creates `<base>/assets/<relative>` files outside the repository. */
function createAssetRoot(files: Record<string, string>) {
  const base = mkdtempSync(path.join(tmpdir(), "maplibre-route-"));
  temporaryRoots.push(base);
  const assetRoot = path.join(base, "assets");
  mkdirSync(assetRoot);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(assetRoot, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return { base, assetRoot };
}

function expectNoStoreNotFound(response: Response): void {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe("MapLibre asset route cache policy", () => {
  it.each(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])(
    "serves the generated %s with immutable caching",
    async (asset) => {
      const response = await requestAsset([version, asset]);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(response.headers.get("content-type")).toBe(
        "text/javascript; charset=utf-8",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const body = Buffer.from(await response.arrayBuffer());
      expect(
        body.equals(
          readFileSync(path.join(root, "node_modules/maplibre-gl/dist", asset)),
        ),
      ).toBe(true);
    },
  );

  it.each([
    [version, "missing.mjs"],
    ["0.0.1", "maplibre-gl-worker.mjs"],
    ["..", "package.json"],
    ["/etc", "passwd"],
    ["%2e%2e", "package.json"],
  ])("returns no-store for missing or unsafe path %s", async (...segments: string[]) => {
    expectNoStoreNotFound(await requestAsset(segments));
  });

  it.each(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])(
    "does not serve the unversioned root URL %s",
    async (asset) => {
      expectNoStoreNotFound(await requestAsset([asset]));
    },
  );

  it("serves assets from an injected root", async () => {
    const { assetRoot } = createAssetRoot({
      "6.4.1/maplibre-gl-worker.mjs": "injected-worker",
    });
    const response = serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
      root: assetRoot,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe("injected-worker");
  });

  it("rejects an asset symlink that escapes the asset root", async () => {
    const { base, assetRoot } = createAssetRoot({
      "6.4.1/maplibre-gl-shared.mjs": "shared",
    });
    const outside = path.join(base, "outside.mjs");
    writeFileSync(outside, "outside-secret");
    symlinkSync(outside, path.join(assetRoot, "6.4.1/maplibre-gl-worker.mjs"));

    const response = serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
      root: assetRoot,
    });
    expectNoStoreNotFound(response);
    expect(await response.text()).not.toContain("outside-secret");
  });

  it("rejects a version directory symlink that escapes the asset root", async () => {
    const { base, assetRoot } = createAssetRoot({});
    const outsideVersion = path.join(base, "outside-version");
    mkdirSync(outsideVersion);
    writeFileSync(
      path.join(outsideVersion, "maplibre-gl-worker.mjs"),
      "outside-secret",
    );
    symlinkSync(outsideVersion, path.join(assetRoot, "6.4.1"));

    const response = serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
      root: assetRoot,
    });
    expectNoStoreNotFound(response);
    expect(await response.text()).not.toContain("outside-secret");
  });

  it("returns no-store for a directory at an asset path", () => {
    const { assetRoot } = createAssetRoot({
      "6.4.1/maplibre-gl-worker.mjs/nested.txt": "directory",
    });
    expectNoStoreNotFound(
      serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
        root: assetRoot,
      }),
    );
  });

  it("leaves MapLibre cache policy to the route instead of next.config headers", async () => {
    const { default: config } = await import("../next.config");
    const rules = (await config.headers?.()) ?? [];
    expect(
      rules.filter((rule) => rule.source.startsWith("/maplibre")),
    ).toEqual([]);
  });
});
