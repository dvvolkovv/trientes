import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
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
  return {
    ...actual,
    copyFileSync: vi.fn(actual.copyFileSync),
    lstatSync: vi.fn(actual.lstatSync),
  };
});

const actualCrypto = await vi.importActual<typeof import("node:crypto")>(
  "node:crypto",
);
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const createHashMock = vi.mocked(createHash);
const copyFileSyncMock = vi.mocked(copyFileSync);
const lstatSyncMock = vi.mocked(lstatSync);
const root = path.resolve(__dirname, "..");
const version = maplibrePackage.version;
const generatedRoot = path.join(root, ".generated/maplibre");
const versionRoot = path.join(generatedRoot, version);

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

// What earlier revisions of the copy script wrote to public/maplibre: root
// copies (2ebc9bf, df5ec07), <version>/ copies with source maps (0b96456 to
// df5ec07) and orphaned atomicCopy temporaries, plus MapLibre's CSP worker.
const LEGACY_GENERATED_FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  ".maplibre-gl-worker.mjs.4242.0b4a6f8e-5c1d-4a8e-9f3b-2d7c6e1a9b05.tmp",
  "6.4.1/maplibre-gl-worker.mjs",
  "6.4.1/maplibre-gl-worker.mjs.map",
  "6.4.1/maplibre-gl-shared.mjs.map",
  "5.24.0/maplibre-gl-csp-worker.js",
  "5.24.0/maplibre-gl-worker.js.map",
];

const fixtureRoots: string[] = [];

/** Writes each `<directory>/<relative>` file with the content "legacy". */
function writeFiles(directory: string, relativePaths: readonly string[]): void {
  for (const relative of relativePaths) {
    const target = path.join(directory, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "legacy");
  }
}

function createFixture(fixtureVersion = "6.4.1") {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "maplibre-copy-"));
  fixtureRoots.push(rootDirectory);
  const distributionDirectory = path.join(
    rootDirectory,
    "node_modules/maplibre-gl/dist",
  );
  mkdirSync(distributionDirectory, { recursive: true });
  writeFileSync(
    path.join(rootDirectory, "node_modules/maplibre-gl/package.json"),
    JSON.stringify({ version: fixtureVersion }),
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
    targetRoot: path.join(rootDirectory, ".generated/maplibre"),
    targetVersion: path.join(rootDirectory, ".generated/maplibre", fixtureVersion),
    legacyPublicRoot: path.join(rootDirectory, "public/maplibre"),
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
  lstatSyncMock.mockReset();
  lstatSyncMock.mockImplementation(actualFs.lstatSync);
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

  it("generates assets outside public/ and without root compatibility copies", () => {
    expect(existsSync(path.join(root, "public/maplibre"))).toBe(false);
    for (const asset of REQUIRED_RUNTIME_ASSETS) {
      expect(existsSync(path.join(generatedRoot, asset)), asset).toBe(false);
    }
  });

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
      expect(existsSync(path.join(fixture.targetRoot, asset))).toBe(false);
    }
    expect(existsSync(fixture.legacyPublicRoot)).toBe(false);
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
      expect(existsSync(path.join(fixture.targetRoot, asset))).toBe(false);
    }
    for (const asset of REQUIRED_TEST_ASSETS.slice(2)) {
      expect(existsSync(path.join(fixture.targetVersion, asset))).toBe(false);
    }
  });

  it.each([false, true])(
    "removes every stale maplibre-gl-*.mjs.map of the current version without source maps (prune: %s)",
    (prune) => {
      const fixture = createFixture();
      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "1" },
      });
      writeFiles(fixture.targetVersion, [
        "maplibre-gl-worker-dev.mjs.map",
        "maplibre-gl-shared-dev.mjs.map",
        "notes.map",
      ]);

      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
        prune,
      });

      expect(readdirSync(fixture.targetVersion).sort()).toEqual([
        "maplibre-gl-shared.mjs",
        "maplibre-gl-worker.mjs",
        "notes.map",
      ]);
    },
  );

  it("leaves older versions and public/maplibre alone without prune", () => {
    const fixture = createFixture("6.4.1");
    createVersionDirectories(fixture.targetRoot, ["6.2.0", "6.3.0", "6.4.0"]);
    writeFiles(fixture.legacyPublicRoot, LEGACY_GENERATED_FILES);

    for (const options of [{}, { prune: false }]) {
      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "1" },
        ...options,
      });
    }

    expect(remainingDirectories(fixture.targetRoot)).toEqual([
      "6.2.0",
      "6.3.0",
      "6.4.0",
      "6.4.1",
    ]);
    for (const legacy of LEGACY_GENERATED_FILES) {
      expect(existsSync(path.join(fixture.legacyPublicRoot, legacy)), legacy).toBe(true);
    }
  });

  it("removes the legacy public/maplibre directory after a successful copy with prune", () => {
    const fixture = createFixture();
    writeFiles(fixture.legacyPublicRoot, LEGACY_GENERATED_FILES);
    const sibling = path.join(fixture.rootDirectory, "public/keep.txt");
    writeFileSync(sibling, "keep");

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    expect(existsSync(fixture.legacyPublicRoot)).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("keep");
    expect(
      readFileSync(
        path.join(fixture.targetVersion, "maplibre-gl-worker.mjs"),
        "utf8",
      ),
    ).toBe("worker-v1");
  });

  it("removes only generated files from public/maplibre and keeps foreign ones", () => {
    const fixture = createFixture();
    const foreign = [
      "custom-style.json",
      "maplibre-gl.css",
      "6.4.1/notes.txt",
      "sprites/maplibre-gl-worker.mjs",
    ];
    writeFiles(fixture.legacyPublicRoot, [...LEGACY_GENERATED_FILES, ...foreign]);
    const outsideTarget = path.join(fixture.rootDirectory, "outside-worker.mjs");
    writeFileSync(outsideTarget, "outside");
    symlinkSync(outsideTarget, path.join(fixture.legacyPublicRoot, "maplibre-gl-worker.js"));

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    for (const legacy of LEGACY_GENERATED_FILES) {
      expect(existsSync(path.join(fixture.legacyPublicRoot, legacy)), legacy).toBe(false);
    }
    for (const kept of foreign) {
      expect(readFileSync(path.join(fixture.legacyPublicRoot, kept), "utf8"), kept).toBe(
        "legacy",
      );
    }
    // Only real files are generated: a symlink is not followed or removed.
    expect(lstatSync(path.join(fixture.legacyPublicRoot, "maplibre-gl-worker.js")).isSymbolicLink()).toBe(true);
    expect(readFileSync(outsideTarget, "utf8")).toBe("outside");
    // Emptied version directories go, a directory with foreign files stays.
    expect(existsSync(path.join(fixture.legacyPublicRoot, "5.24.0"))).toBe(false);
    expect(existsSync(path.join(fixture.legacyPublicRoot, "6.4.1"))).toBe(true);
  });

  it("uses stat for clean files and SHA-256 only for stat mismatches", () => {
    const fixture = createFixture();
    const environment = { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" };
    copyMapLibreAssets({ rootDirectory: fixture.rootDirectory, environment });
    expect(copyFileSyncMock).toHaveBeenCalledTimes(2);
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

  function createVersionDirectories(targetRoot: string, directories: string[]): void {
    for (const directory of directories) {
      mkdirSync(path.join(targetRoot, directory, "nested"), { recursive: true });
      writeFileSync(path.join(targetRoot, directory, "nested/keep.txt"), directory);
    }
  }

  function remainingDirectories(targetRoot: string): string[] {
    return readdirSync(targetRoot).sort();
  }

  it("keeps the current and the previous version and removes older ones with prune", () => {
    const fixture = createFixture("6.4.1");
    createVersionDirectories(fixture.targetRoot, ["6.3.0", "6.4.0"]);

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    expect(remainingDirectories(fixture.targetRoot)).toEqual(["6.4.0", "6.4.1"]);
    expect(
      readFileSync(path.join(fixture.targetRoot, "6.4.0/nested/keep.txt"), "utf8"),
    ).toBe("6.4.0");
  });

  it("picks the previous version by numeric semver, not by name", () => {
    const fixture = createFixture("6.10.0");
    createVersionDirectories(fixture.targetRoot, [
      "6.2.0",
      "6.9.0",
      "6.4.1",
      "6.3.10",
      "6.3.9",
    ]);

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    expect(remainingDirectories(fixture.targetRoot)).toEqual(["6.10.0", "6.9.0"]);
  });

  it("keeps the numerically newest older version as N-1 among older versions only", () => {
    const fixture = createFixture("6.4.0");
    createVersionDirectories(fixture.targetRoot, ["6.3.9", "6.3.10"]);

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    expect(remainingDirectories(fixture.targetRoot)).toEqual(["6.3.10", "6.4.0"]);
  });

  it("never removes newer versions, non-version directories or outside files", () => {
    const fixture = createFixture("6.4.1");
    createVersionDirectories(fixture.targetRoot, [
      "6.3.9",
      "6.4.0",
      "6.4.2",
      "6.10.0",
      "6.4.1-rc.1",
      "not-a-version",
    ]);
    const outside = path.join(fixture.rootDirectory, "outside.txt");
    writeFileSync(outside, "keep");

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      prune: true,
    });

    expect(remainingDirectories(fixture.targetRoot)).toEqual([
      "6.10.0",
      "6.4.0",
      "6.4.1",
      "6.4.1-rc.1",
      "6.4.2",
      "not-a-version",
    ]);
    expect(existsSync(outside)).toBe(true);
  });

  it("removes orphaned temporary files older than five minutes before copying", () => {
    const fixture = createFixture();
    mkdirSync(fixture.targetVersion, { recursive: true });
    const staleInVersion = path.join(
      fixture.targetVersion,
      ".maplibre-gl-worker.mjs.111.stale.tmp",
    );
    const staleInRoot = path.join(
      fixture.targetRoot,
      ".maplibre-gl-worker.mjs.222.stale.tmp",
    );
    // A parallel run's temp file: atomicCopy backdates its mtime to the source
    // mtime before the rename, so only its ctime says it is fresh.
    const freshInVersion = path.join(
      fixture.targetVersion,
      ".maplibre-gl-shared.mjs.333.fresh.tmp",
    );
    const staleDirectory = path.join(fixture.targetVersion, ".directory.tmp");
    const unrelatedDotfile = path.join(fixture.targetVersion, ".keep");
    for (const file of [staleInVersion, staleInRoot, freshInVersion, unrelatedDotfile]) {
      writeFileSync(file, "temporary");
    }
    mkdirSync(staleDirectory);
    const longAgo = new Date("2020-01-01T00:00:00Z");
    utimesSync(freshInVersion, longAgo, longAgo);

    const stale = new Set([staleInVersion, staleInRoot, staleDirectory, unrelatedDotfile]);
    lstatSyncMock.mockImplementation(((filePath: string, options?: object) => {
      const stats = actualFs.lstatSync(filePath, options);
      if (stale.has(String(filePath))) {
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        Object.assign(stats, { ctimeMs: tenMinutesAgo, mtimeMs: tenMinutesAgo });
      }
      return stats;
    }) as typeof lstatSync);

    copyMapLibreAssets({
      rootDirectory: fixture.rootDirectory,
      environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
    });

    expect(existsSync(staleInVersion)).toBe(false);
    expect(existsSync(staleInRoot)).toBe(false);
    expect(existsSync(freshInVersion)).toBe(true);
    expect(existsSync(staleDirectory)).toBe(true);
    expect(existsSync(unrelatedDotfile)).toBe(true);
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
    mkdirSync(path.join(fixture.targetRoot, "6.3.0"), { recursive: true });
    mkdirSync(path.join(fixture.targetRoot, "6.4.0"), { recursive: true });
    writeFiles(fixture.legacyPublicRoot, LEGACY_GENERATED_FILES);
    copyFileSyncMock.mockImplementation((_source, temporaryPath) => {
      writeFileSync(temporaryPath, "PARTIAL");
      throw new Error("injected copy failure");
    });

    expect(() =>
      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
        prune: true,
      }),
    ).toThrow("injected copy failure");
    expect(readFileSync(destination, "utf8")).toBe("OLD-COMPLETE-CONTENT");
    expect(
      readdirSync(fixture.targetVersion).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    // Cleanup runs only after a successful copy: even the stale 6.3.0 survives.
    expect(existsSync(path.join(fixture.targetRoot, "6.3.0"))).toBe(true);
    expect(existsSync(path.join(fixture.targetRoot, "6.4.0"))).toBe(true);
    for (const legacy of LEGACY_GENERATED_FILES) {
      expect(existsSync(path.join(fixture.legacyPublicRoot, legacy)), legacy).toBe(true);
    }
  });
});

describe("MapLibre copy without an installed maplibre-gl", () => {
  const NOT_INSTALLED = "maplibre-gl is not installed; run npm install";

  it("throws a clear error before creating any target directory", () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, "node_modules"), {
      recursive: true,
      force: true,
    });

    expect(() =>
      copyMapLibreAssets({
        rootDirectory: fixture.rootDirectory,
        environment: { MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      }),
    ).toThrow(NOT_INSTALLED);
    expect(existsSync(path.join(fixture.rootDirectory, ".generated"))).toBe(false);
  });

  it("exits with code 1 and prints the message without a stack trace", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "maplibre-cli-"));
    fixtureRoots.push(projectRoot);
    const script = path.join(projectRoot, "scripts/copy-maplibre-worker.mjs");
    mkdirSync(path.dirname(script));
    actualFs.copyFileSync(
      path.join(root, "scripts/copy-maplibre-worker.mjs"),
      script,
    );

    const result = spawnSync(process.execPath, [script], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(NOT_INSTALLED);
    expect(result.stderr).not.toMatch(/^\s+at /m);
    expect(existsSync(path.join(projectRoot, ".generated"))).toBe(false);
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
    expect(packageJson.scripts.predev).toContain(
      "MAPLIBRE_INCLUDE_SOURCE_MAPS=1",
    );
    expect(packageJson.scripts.predev).toContain(
      "node scripts/copy-maplibre-worker.mjs",
    );
    expect(packageJson.scripts.prebuild).toContain(
      "MAPLIBRE_INCLUDE_SOURCE_MAPS=0",
    );
    expect(packageJson.scripts.prebuild).toContain(
      "node scripts/copy-maplibre-worker.mjs",
    );
    // Only a build may delete: the production checkout also runs dev and tests.
    expect(packageJson.scripts.prebuild).toMatch(/\s--prune(?:\s|$)/);
    expect(packageJson.scripts.predev).not.toContain("--prune");

    // npm test, npm run test:watch and a bare npx vitest all load
    // vitest.config.ts, whose globalSetup copies the assets with source maps
    // once per run; an npm pre-hook would only duplicate that copy.
    expect(packageJson.scripts.pretest).toBeUndefined();
    expect(packageJson.scripts["pretest:watch"]).toBeUndefined();
    expect(readFileSync(path.join(root, "vitest.config.ts"), "utf8")).toMatch(
      /globalSetup:\s*\[\s*"\.\/tests\/globalSetup\.ts"\s*\]/,
    );
    expect(readFileSync(path.join(root, "tests/globalSetup.ts"), "utf8")).toContain(
      'MAPLIBRE_INCLUDE_SOURCE_MAPS: "1"',
    );
  });

  it("copies from Vitest globalSetup without pruning", async () => {
    const copy = vi.fn();
    vi.resetModules();
    vi.doMock("../scripts/copy-maplibre-worker.mjs", () => ({
      copyMapLibreAssets: copy,
    }));
    try {
      const { default: prepareMapLibreAssets } = await import("./globalSetup");
      prepareMapLibreAssets();
    } finally {
      vi.doUnmock("../scripts/copy-maplibre-worker.mjs");
      vi.resetModules();
    }

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).not.toHaveProperty("prune", true);
  });

  it("prunes from the command line only with --prune", () => {
    const run = (args: string[]) => {
      const fixture = createFixture("6.4.1");
      for (const directory of ["6.3.0", "6.4.0"]) {
        mkdirSync(path.join(fixture.targetRoot, directory), { recursive: true });
      }
      writeFiles(fixture.legacyPublicRoot, ["maplibre-gl-worker.mjs"]);
      const script = path.join(fixture.rootDirectory, "scripts/copy-maplibre-worker.mjs");
      mkdirSync(path.dirname(script));
      actualFs.copyFileSync(path.join(root, "scripts/copy-maplibre-worker.mjs"), script);

      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: fixture.rootDirectory,
        encoding: "utf8",
        env: { ...process.env, MAPLIBRE_INCLUDE_SOURCE_MAPS: "0" },
      });
      expect(result.status, result.stderr).toBe(0);
      return {
        versions: readdirSync(fixture.targetRoot).sort(),
        legacy: existsSync(fixture.legacyPublicRoot),
      };
    };

    expect(run([])).toEqual({ versions: ["6.3.0", "6.4.0", "6.4.1"], legacy: true });
    expect(run(["--prune"])).toEqual({ versions: ["6.4.0", "6.4.1"], legacy: false });
  });
});
