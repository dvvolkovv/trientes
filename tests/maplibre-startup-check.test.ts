import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  checkMapLibreAssets,
  findMissingMapLibreAssets,
} from "../src/lib/maplibre-assets";

const version = maplibrePackage.version;
const WORKER = `${version}/maplibre-gl-worker.mjs`;
const SHARED = `${version}/maplibre-gl-shared.mjs`;

let errors: MockInstance<typeof console.error>;
let base: string;
let assetRoot: string;

function writeAssets(relativePaths: string[]): void {
  for (const relativePath of relativePaths) {
    const target = path.join(assetRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, relativePath);
  }
}

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  base = mkdtempSync(path.join(tmpdir(), "maplibre-startup-check-"));
  assetRoot = path.join(base, "assets");
  mkdirSync(assetRoot);
});

afterEach(() => {
  errors.mockRestore();
  rmSync(base, { recursive: true, force: true });
});

describe("findMissingMapLibreAssets", () => {
  it("finds nothing missing when both runtime assets exist", () => {
    writeAssets([WORKER, SHARED]);
    expect(findMissingMapLibreAssets({ root: assetRoot })).toEqual([]);
  });

  it("lists each missing runtime asset of the installed version", () => {
    writeAssets([WORKER]);
    expect(findMissingMapLibreAssets({ root: assetRoot })).toEqual([SHARED]);
  });

  it("lists both assets when the asset root does not exist", () => {
    expect(
      findMissingMapLibreAssets({ root: path.join(base, "missing") }),
    ).toEqual([WORKER, SHARED]);
  });

  it("treats a directory at an asset path as missing", () => {
    writeAssets([SHARED, `${WORKER}/nested.txt`]);
    expect(findMissingMapLibreAssets({ root: assetRoot })).toEqual([WORKER]);
  });

  it("ignores other versions and checks an injected version", () => {
    writeAssets([WORKER, SHARED, "9.9.9/maplibre-gl-worker.mjs"]);
    expect(findMissingMapLibreAssets({ root: assetRoot, version: "9.9.9" })).toEqual([
      "9.9.9/maplibre-gl-shared.mjs",
    ]);
  });

  it("treats a path the filesystem rejects as missing instead of throwing", () => {
    expect(findMissingMapLibreAssets({ root: "invalid\0root" })).toEqual([
      WORKER,
      SHARED,
    ]);
  });

  it("checks <cwd>/.generated/maplibre by default", () => {
    // Vitest globalSetup copies the installed assets into the repository.
    expect(findMissingMapLibreAssets()).toEqual([]);
  });
});

describe("checkMapLibreAssets", () => {
  it("passes silently when the runtime assets exist", () => {
    writeAssets([WORKER, SHARED]);
    expect(checkMapLibreAssets({ root: assetRoot })).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("logs a deployment error naming every missing asset", () => {
    writeAssets([SHARED]);
    expect(checkMapLibreAssets({ root: assetRoot })).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    const message = errors.mock.calls[0].join(" ");
    expect(message).toContain("DEPLOYMENT ERROR");
    expect(message).toContain(`.generated/maplibre/${WORKER}`);
    expect(message).not.toContain(`.generated/maplibre/${SHARED}`);
    expect(message).toContain("npm run build");
    expect(message).not.toContain(base);
  });

  it("logs instead of throwing when the check itself cannot run", () => {
    expect(() => checkMapLibreAssets({ root: "invalid\0root" })).not.toThrow();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
