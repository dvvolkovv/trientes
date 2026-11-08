import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import maplibrePackage from "maplibre-gl/package.json";
import * as ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyMapLibreAssets,
  sha256,
} from "../scripts/copy-maplibre-worker.mjs";
import { MAPLIBRE_WORKER_URL } from "../src/lib/maplibre-worker-url";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) };
});

const actualCrypto = await vi.importActual<typeof import("node:crypto")>(
  "node:crypto",
);
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const createHashMock = vi.mocked(createHash);
const copyFileSyncMock = vi.mocked(copyFileSync);
const root = path.resolve(__dirname, "..");
const version = maplibrePackage.version;
const versionRoot = path.join(root, "public/maplibre", version);

// Deliberately independent of the copy script manifest. Removing a required
// asset from that manifest must fail these assertions rather than vacuously pass.
const REQUIRED_RUNTIME_ASSETS = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
] as const;
const REQUIRED_TEST_ASSETS = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker.mjs.map",
  "maplibre-gl-shared.mjs.map",
] as const;

const fixtureRoots: string[] = [];

function createFixture() {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "maplibre-copy-"));
  fixtureRoots.push(rootDirectory);
  const distributionDirectory = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/dist",
  );
  mkdirSync(distributionDirectory, { recursive: true });
  writeFileSync(
    path.join(rootDirectory, "node_modules/maplibre-gl/package.json"),
    JSON.stringify({ version: "6.4.1" }),
  );
  const contents: Record<string, string> = {
    "maplibre-gl-worker.mjs": "worker-v1",
    "maplibre-gl-shared.mjs": "shared-v1",
    "maplibre-gl-worker.mjs.map": "worker-map-v1",
    "maplibre-gl-shared.mjs.map": "shared-map-v1",
  };
  for (const [asset, content] of Object.entries(contents)) {
    writeFileSync(path.join(distributionDirectory, asset), content);
  }
  return {
    rootDirectory,
    distributionDirectory,
    targetRoot: path.join(rootDirectory, "public/maplibre"),
    targetVersion: path.join(rootDirectory, "public/maplibre/6.4.1"),
  };
}

function assertInsideVersionRoot(candidate: string): void {
  const relative = path.relative(versionRoot, candidate);
  expect(relative).not.toBe("");
  expect(relative).not.toBe("..");
  expect(relative.startsWith(`..${path.sep}`)).toBe(false);
  expect(path.isAbsolute(relative)).toBe(false);
}

function checkComponentConfiguration(relativePath: string): void {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(path.join(root, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hasWorkerImport = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      !statement.importClause &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/lib/maplibre-worker",
  );
  let hasAttributionOptions = false;
  let hasStaticAttribution = false;
  function visit(node: ts.Node): void {
    if (
      ts.isSpreadAssignment(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "MAPLIBRE_ATTRIBUTION_OPTIONS"
    ) {
      hasAttributionOptions = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "addStaticMapAttribution" &&
      node.arguments.length === 1 &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === "map"
    ) {
      hasStaticAttribution = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(hasWorkerImport, `${relativePath} must configure the shared worker`).toBe(true);
  expect(hasAttributionOptions, `${relativePath} must disable remote attribution`).toBe(true);
  expect(hasStaticAttribution, `${relativePath} must add static attribution`).toBe(true);
}

beforeEach(() => {
  copyFileSyncMock.mockReset();
  copyFileSyncMock.mockImplementation(actualFs.copyFileSync);
  createHashMock.mockReset();
  createHashMock.mockImplementation(actualCrypto.createHash);
});

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("MapLibre worker URL and generated asset closure", () => {
  it("uses the installed version without loading the MapLibre engine", () => {
    expect(MAPLIBRE_WORKER_URL).toBe(
      `/maplibre/${version}/maplibre-gl-worker.mjs`,
    );
  });

  it.each(REQUIRED_TEST_ASSETS)(
    "ships an identical versioned dev/test asset %s",
    (asset) => {
      const target = path.join(versionRoot, asset);
      const distribution = path.join(
        root,
        "node_modules/maplibre-gl/dist",
        asset,
      );
      expect(readFileSync(target).equals(readFileSync(distribution))).toBe(true);
    },
  );

  it.each(REQUIRED_RUNTIME_ASSETS)(
    "ships the root compatibility asset %s",
    (asset) => {
      const target = path.join(root, "public/maplibre", asset);
      const distribution = path.join(
        root,
        "node_modules/maplibre-gl/dist",
        asset,
      );
      expect(readFileSync(target).equals(readFileSync(distribution))).toBe(true);
    },
  );

  it("covers every relative static import and sourceMappingURL from the worker", () => {
    const pending = [path.join(versionRoot, "maplibre-gl-worker.mjs")];
    const visited = new Set<string>();

    while (pending.length) {
      const modulePath = pending.pop()!;
      if (visited.has(modulePath)) continue;
      visited.add(modulePath);
      assertInsideVersionRoot(modulePath);
      expect(existsSync(modulePath), `${modulePath} must exist`).toBe(true);

      const source = readFileSync(modulePath, "utf8");
      const parsed = ts.createSourceFile(
        modulePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      for (const statement of parsed.statements) {
        if (
          (ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.startsWith(".")
        ) {
          pending.push(
            path.resolve(path.dirname(modulePath), statement.moduleSpecifier.text),
          );
        }
      }

      for (const match of source.matchAll(
        /\/\/#\s*sourceMappingURL=([^\s]+)/g,
      )) {
        const sourceMap = path.resolve(path.dirname(modulePath), match[1]);
        assertInsideVersionRoot(sourceMap);
        expect(existsSync(sourceMap), `${sourceMap} must exist`).toBe(true);
      }
    }

    expect(visited).toContain(
      path.join(versionRoot, "maplibre-gl-shared.mjs"),
    );
  });
});

describe("MapLibre copy modes and idempotence", () => {
  it.each([
    ["the explicit dev/test option", { MAPLIBRE_INCLUDE_SOURCE_MAPS: "1" }],
    ["development mode", { NODE_ENV: "development" }],
  ])("includes source maps with %s", (_name, environment) => {
    const fixture = createFixture();
    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment,
    });
    for (const asset of REQUIRED_TEST_ASSETS) {
      expect(readFileSync(path.join(fixture.targetVersion, asset), "utf8")).toBe(
        readFileSync(path.join(fixture.distributionDirectory, asset), "utf8"),
      );
    }
    for (const asset of REQUIRED_RUNTIME_ASSETS) {
      expect(existsSync(path.join(fixture.targetRoot, asset))).toBe(true);
    }
  });

  it("copies only runtime assets in production and removes stale source maps", () => {
    const fixture = createFixture();
    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "1" },
    });
    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: {
        NODE_ENV: "development",
        MAPLIBRE_INCLUDE_SOURCE_MAPS: "0",
      },
    });

    for (const asset of REQUIRED_RUNTIME_ASSETS) {
      expect(existsSync(path.join(fixture.targetVersion, asset))).toBe(true);
      expect(existsSync(path.join(fixture.targetRoot, asset))).toBe(true);
    }
    for (const asset of REQUIRED_TEST_ASSETS.slice(2)) {
      expect(existsSync(path.join(fixture.targetVersion, asset))).toBe(false);
    }
  });

  it("uses stat for clean files and SHA-256 only for stat mismatches", () => {
    const fixture = createFixture();
    const environment = { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" };
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    expect(copyFileSyncMock).toHaveBeenCalledTimes(4);
    expect(createHashMock).not.toHaveBeenCalled();

    copyFileSyncMock.mockClear();
    createHashMock.mockClear();
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    expect(copyFileSyncMock).not.toHaveBeenCalled();
    expect(createHashMock).not.toHaveBeenCalled();

    const source = path.join(
      fixture.distributionDirectory,
      "maplibre-gl-worker.mjs",
    );
    const destination = path.join(
      fixture.targetVersion,
      "maplibre-gl-worker.mjs",
    );
    const sourceStat = statSync(source);
    utimesSync(
      destination,
      sourceStat.atimeMs / 1000,
      sourceStat.mtimeMs / 1000 - 10,
    );
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    expect(copyFileSyncMock).not.toHaveBeenCalled();
    expect(createHashMock).toHaveBeenCalledTimes(2);
    expect(Math.abs(statSync(destination).mtimeMs - sourceStat.mtimeMs)).toBeLessThan(1);

    createHashMock.mockClear();
    writeFileSync(destination, "WORKER-v1");
    utimesSync(
      destination,
      sourceStat.atimeMs / 1000,
      sourceStat.mtimeMs / 1000 - 10,
    );
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    expect(copyFileSyncMock).toHaveBeenCalledTimes(1);
    expect(createHashMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(destination, "utf8")).toBe(readFileSync(source, "utf8"));
  });

  it("removes only older stable version directories after a successful copy", () => {
    const fixture = createFixture();
    for (const directory of [
      "6.4.0",
      "6.3.9",
      "6.4.2",
      "6.10.0",
      "not-a-version",
    ]) {
      mkdirSync(path.join(fixture.targetRoot, directory, "nested"), {
        recursive: true,
      });
      writeFileSync(
        path.join(fixture.targetRoot, directory, "nested/keep.txt"),
        directory,
      );
    }
    const outside = path.join(fixture.rootDirectory, "outside.txt");
    writeFileSync(outside, "keep");

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
    });

    expect(existsSync(path.join(fixture.targetRoot, "6.4.0"))).toBe(false);
    expect(existsSync(path.join(fixture.targetRoot, "6.3.9"))).toBe(false);
    expect(existsSync(path.join(fixture.targetRoot, "6.4.2"))).toBe(true);
    expect(existsSync(path.join(fixture.targetRoot, "6.10.0"))).toBe(true);
    expect(existsSync(path.join(fixture.targetRoot, "not-a-version"))).toBe(true);
    expect(existsSync(outside)).toBe(true);
    for (const asset of REQUIRED_RUNTIME_ASSETS) {
      expect(existsSync(path.join(fixture.targetRoot, asset))).toBe(true);
    }
  });

  it("keeps a complete old file visible to a parallel reader during replacement", async () => {
    const fixture = createFixture();
    const environment = { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" };
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    const destination = path.join(
      fixture.targetVersion,
      "maplibre-gl-worker.mjs",
    );
    const source = path.join(
      fixture.distributionDirectory,
      "maplibre-gl-worker.mjs",
    );
    const oldContent = "OLD-COMPLETE-CONTENT";
    writeFileSync(destination, oldContent);

    const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const state = new Int32Array(shared);
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads");
        const { readFileSync } = require("node:fs");
        const state = new Int32Array(workerData.state);
        Atomics.wait(state, 0, 0);
        const content = readFileSync(workerData.destination, "utf8");
        Atomics.store(state, 0, 2);
        Atomics.notify(state, 0);
        parentPort.postMessage(content);
      `,
      { eval: true, workerData: { state: shared, destination } },
    );
    const duringCopy = new Promise<string>((resolve) => {
      worker.once("message", resolve);
    });

    copyFileSyncMock.mockImplementation((sourcePath, temporaryPath) => {
      writeFileSync(temporaryPath, "PARTIAL");
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      if (Atomics.wait(state, 0, 1, 5000) === "timed-out") {
        throw new Error("parallel reader timed out");
      }
      writeFileSync(temporaryPath, readFileSync(sourcePath));
    });

    try {
      copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
      expect(await duringCopy).toBe(oldContent);
      expect(readFileSync(destination, "utf8")).toBe(readFileSync(source, "utf8"));
      expect(sha256(destination)).toBe(sha256(source));
      expect(
        readdirSync(fixture.targetVersion).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    } finally {
      await worker.terminate();
    }
  });

  it("removes temporary files and preserves the old asset after a copy error", () => {
    const fixture = createFixture();
    mkdirSync(fixture.targetVersion, { recursive: true });
    const destination = path.join(
      fixture.targetVersion,
      "maplibre-gl-worker.mjs",
    );
    writeFileSync(destination, "OLD-COMPLETE-CONTENT");
    mkdirSync(path.join(fixture.targetRoot, "6.4.0"), { recursive: true });
    copyFileSyncMock.mockImplementation((_source, temporaryPath) => {
      writeFileSync(temporaryPath, "PARTIAL");
      throw new Error("injected copy failure");
    });

    expect(() =>
      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      }),
    ).toThrow("injected copy failure");
    expect(readFileSync(destination, "utf8")).toBe("OLD-COMPLETE-CONTENT");
    expect(
      readdirSync(fixture.targetVersion).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect(existsSync(path.join(fixture.targetRoot, "6.4.0"))).toBe(true);
  });
});

describe("MapLibre component and lifecycle configuration", () => {
  it.each([
    "src/components/business/point-form.tsx",
    "src/components/coin-detail/crypto-navigator.tsx",
  ])("keeps shared worker and static attribution in %s", (relativePath) => {
    checkComponentConfiguration(relativePath);
  });

  it("prepares dev/test source maps and production runtime assets explicitly", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    for (const hook of ["predev", "pretest", "pretest:watch"]) {
      expect(packageJson.scripts[hook]).toContain(
        "MAPLIBRE_INCLUDE_SOURCE_MAPS=1",
      );
      expect(packageJson.scripts[hook]).toContain(
        "node scripts/copy-maplibre-worker.mjs",
      );
    }
    expect(packageJson.scripts.prebuild).toContain(
      "MAPLIBRE_INCLUDE_SOURCE_MAPS=0",
    );
    expect(packageJson.scripts.prebuild).toContain(
      "node scripts/copy-maplibre-worker.mjs",
    );
  });
});
