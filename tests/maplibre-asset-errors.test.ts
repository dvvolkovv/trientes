import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

type MapLibreAssets = typeof import("../src/lib/maplibre-assets");

const version = maplibrePackage.version;
const WORKER = `${version}/maplibre-gl-worker.mjs`;
const SHARED = `${version}/maplibre-gl-shared.mjs`;

let serveMapLibreAsset: MapLibreAssets["serveMapLibreAsset"];
let errors: MockInstance<typeof console.error>;
let base: string;
let assetRoot: string;

function messages(): string[] {
  return errors.mock.calls.map((args) => args.join(" "));
}

function serve(relativePath: string, options: { root?: string; nodeEnv?: string } = {}) {
  return serveMapLibreAsset(relativePath.split("/"), { root: assetRoot, ...options });
}

beforeEach(async () => {
  // A fresh module per test, so its once-per-process reports start empty.
  vi.resetModules();
  ({ serveMapLibreAsset } = await import("../src/lib/maplibre-assets"));
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  base = mkdtempSync(path.join(tmpdir(), "maplibre-asset-errors-"));
  assetRoot = path.join(base, "assets");
  mkdirSync(path.join(assetRoot, version), { recursive: true });
});

afterEach(() => {
  errors.mockRestore();
  rmSync(base, { recursive: true, force: true });
});

describe("MapLibre asset read errors", () => {
  it("reports a missing runtime asset of the installed version once per path", () => {
    for (const relativePath of [WORKER, WORKER, SHARED, WORKER, SHARED]) {
      expect(serve(relativePath).status).toBe(404);
    }

    expect(messages()).toHaveLength(2);
    const [worker, shared] = messages();
    expect(worker).toContain(`.generated/maplibre/${WORKER}`);
    expect(worker).toContain("ENOENT");
    expect(worker).toContain("npm run build");
    expect(shared).toContain(`.generated/maplibre/${SHARED}`);
    expect(shared).toContain("npm run build");
    for (const message of messages()) expect(message).not.toContain(base);
  });

  it("reports a missing asset root as a deployment error", () => {
    expect(serve(WORKER, { root: path.join(base, "missing") }).status).toBe(404);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain("npm run build");
    expect(messages()[0]).not.toContain(base);
  });

  it("reports a version path that is not a directory as missing", () => {
    rmSync(path.join(assetRoot, version), { recursive: true });
    writeFileSync(path.join(assetRoot, version), "not a directory");
    expect(serve(SHARED).status).toBe(404);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain("ENOTDIR");
    expect(messages()[0]).toContain("npm run build");
  });

  it.each(["0.0.1/maplibre-gl-worker.mjs", "0.0.1/maplibre-gl-shared.mjs"])(
    "stays silent for a missing asset of another version: %s",
    (relativePath) => {
      expect(serve(relativePath).status).toBe(404);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it.each([`${WORKER}.map`, `${SHARED}.map`])(
    "stays silent for a missing source map of the installed version: %s",
    (relativePath) => {
      expect(serve(relativePath, { nodeEnv: "development" }).status).toBe(404);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it("stays silent when the runtime assets are present", () => {
    writeFileSync(path.join(assetRoot, WORKER), "worker");
    writeFileSync(path.join(assetRoot, SHARED), "shared");
    expect(serve(WORKER).status).toBe(200);
    expect(serve(SHARED).status).toBe(200);
    expect(errors).not.toHaveBeenCalled();
  });
});
