import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/maplibre/[...path]/route";
import { serveMapLibreAsset } from "../src/lib/maplibre-assets";

// Pass-through spies: they prove a rejected path never reaches the disk.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    realpathSync: Object.assign(vi.fn(actual.realpathSync), {
      native: actual.realpathSync.native,
    }),
    statSync: vi.fn(actual.statSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

const root = path.resolve(__dirname, "..");
const version = maplibrePackage.version;
const IMMUTABLE = "public, max-age=31536000, immutable";
const temporaryRoots: string[] = [];
const diskReads = [
  vi.mocked(realpathSync),
  vi.mocked(statSync),
  vi.mocked(readFileSync),
];

function resetDiskReads(): void {
  for (const spy of diskReads) spy.mockClear();
}

function expectNoDiskReads(): void {
  for (const spy of diskReads) expect(spy).not.toHaveBeenCalled();
}

function requestAsset(segments: string[]): Promise<Response> {
  return GET(new Request(`http://localhost/maplibre/${segments.join("/")}`), {
    params: Promise.resolve({ path: segments }),
  });
}

/** Writes `<base>/assets/<relative>` files outside the repository. */
function writeAssetTree(files: Record<string, string>) {
  const base = mkdtempSync(path.join(tmpdir(), "maplibre-route-"));
  const assetRoot = path.join(base, "assets");
  mkdirSync(assetRoot);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(assetRoot, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return { base, assetRoot };
}

/** Same as writeAssetTree, removed again after the current test. */
function createAssetRoot(files: Record<string, string>) {
  const tree = writeAssetTree(files);
  temporaryRoots.push(tree.base);
  return tree;
}

// Every rejected allowlist case exists here on disk, so its 404 can only come
// from the allowlist.
const ALLOWLIST_FIXTURE = {
  "6.4.1/evil.mjs": "evil",
  "6.4.1/maplibre-gl-worker.mjs": "worker",
  "6.4.1/maplibre-gl-worker.mjs.map": "{}",
  "6.4.1/maplibre-gl-worker.mjs.map.bak": "{}",
  "6.4.1/maplibre-gl-worker.js": "worker",
  "6.4.1/maplibre-gl-csp-worker.mjs": "worker",
  "6.4.1/nested/maplibre-gl-worker.mjs": "worker",
  "6.4/maplibre-gl-worker.mjs": "worker",
  "v6.4.1/maplibre-gl-worker.mjs": "worker",
  "6.4.1-rc.1/maplibre-gl-worker.mjs": "worker",
  "maplibre-gl-worker.mjs": "worker",
  "maplibre-gl-shared.mjs": "shared",
};

function expectNoStoreNotFound(response: Response): void {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe("MapLibre asset route cache policy", () => {
  it.each(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])(
    "serves the generated %s with immutable caching",
    async (asset) => {
      resetDiskReads();
      const response = await requestAsset([version, asset]);
      expect(response.status).toBe(200);
      // Served through the realpath containment check, not a bare read.
      expect(realpathSync).toHaveBeenCalled();
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

  it("returns no-store when the asset root does not exist", () => {
    const { base } = createAssetRoot({});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expectNoStoreNotFound(
        serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
          root: path.join(base, "missing"),
        }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    "returns no-store and logs an unreadable asset without its absolute path",
    () => {
      const { base, assetRoot } = createAssetRoot({
        "6.4.1/maplibre-gl-worker.mjs": "worker",
      });
      const asset = path.join(assetRoot, "6.4.1/maplibre-gl-worker.mjs");
      chmodSync(asset, 0o000);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expectNoStoreNotFound(
          serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
            root: assetRoot,
          }),
        );
        expect(errors).toHaveBeenCalledTimes(1);
        const message = errors.mock.calls[0].join(" ");
        expect(message).toContain("6.4.1/maplibre-gl-worker.mjs");
        expect(message).toContain("EACCES");
        expect(message).not.toContain(base);
      } finally {
        errors.mockRestore();
        chmodSync(asset, 0o644);
      }
    },
  );

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

  describe("strict asset allowlist", () => {
    // The spies prove a rejected path never reaches the disk.
    let tree: ReturnType<typeof writeAssetTree>;
    let assetRoot: string;
    beforeAll(() => {
      tree = writeAssetTree(ALLOWLIST_FIXTURE);
      assetRoot = tree.assetRoot;
    });
    afterAll(() => rmSync(tree.base, { recursive: true, force: true }));

    it.each([
      ["6.4.1", "evil.mjs"],
      ["6.4.1", "maplibre-gl-worker.js"],
      ["6.4.1", "maplibre-gl-csp-worker.mjs"],
      ["6.4.1", "maplibre-gl-worker.mjs.map.bak"],
      ["6.4.1", "nested", "maplibre-gl-worker.mjs"],
      ["6.4", "maplibre-gl-worker.mjs"],
      ["v6.4.1", "maplibre-gl-worker.mjs"],
      ["6.4.1-rc.1", "maplibre-gl-worker.mjs"],
      ["maplibre-gl-worker.mjs"],
      ["maplibre-gl-shared.mjs"],
    ].map((segments) => [segments.join("/"), segments] as const))(
      "rejects %s without reading the disk",
      (_label, segments) => {
        resetDiskReads();
        expectNoStoreNotFound(
          serveMapLibreAsset(segments, { root: assetRoot, nodeEnv: "development" }),
        );
        expectNoDiskReads();
      },
    );

    it("rejects one segment carrying a slash without reading the disk", () => {
      // Joined, it would pass the allowlist as 6.4.1/maplibre-gl-worker.mjs.
      resetDiskReads();
      expectNoStoreNotFound(
        serveMapLibreAsset(["6.4.1/maplibre-gl-worker.mjs"], { root: assetRoot }),
      );
      expectNoDiskReads();
    });

    it.each([
      ["undefined", undefined],
      ["[]", []],
    ])("rejects an empty path %s without reading the disk", (_label, segments) => {
      resetDiskReads();
      expectNoStoreNotFound(serveMapLibreAsset(segments, { root: assetRoot }));
      expectNoDiskReads();
    });

    it("rejects source maps in production without reading the disk", () => {
      resetDiskReads();
      expectNoStoreNotFound(
        serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs.map"], {
          root: assetRoot,
          nodeEnv: "production",
        }),
      );
      expectNoDiskReads();
    });

    it("serves source maps outside production", async () => {
      const response = serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs.map"], {
        root: assetRoot,
        nodeEnv: "development",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toBe("{}");
    });

    it("still serves allowlisted runtime assets in production", async () => {
      const response = serveMapLibreAsset(["6.4.1", "maplibre-gl-worker.mjs"], {
        root: assetRoot,
        nodeEnv: "production",
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("worker");
    });
  });

  it.each(["maplibre-gl-worker.mjs.map", "maplibre-gl-shared.mjs.map"])(
    "GET returns 404 no-store for %s when NODE_ENV=production",
    async (asset) => {
      vi.stubEnv("NODE_ENV", "production");
      resetDiskReads();
      expectNoStoreNotFound(await requestAsset([version, asset]));
      expectNoDiskReads();
    },
  );

  it.each(["maplibre-gl-worker.mjs.map", "maplibre-gl-shared.mjs.map"])(
    "GET serves the generated %s when NODE_ENV=development",
    async (asset) => {
      vi.stubEnv("NODE_ENV", "development");
      const response = await requestAsset([version, asset]);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      const body = Buffer.from(await response.arrayBuffer());
      expect(
        body.equals(
          readFileSync(path.join(root, "node_modules/maplibre-gl/dist", asset)),
        ),
      ).toBe(true);
    },
  );

  it("leaves MapLibre cache policy to the route instead of next.config headers", async () => {
    const { default: config } = await import("../next.config");
    const rules = (await config.headers?.()) ?? [];
    expect(
      rules.filter((rule) => rule.source.startsWith("/maplibre")),
    ).toEqual([]);
  });
});
