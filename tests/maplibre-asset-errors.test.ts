import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

type MapLibreAssets = typeof import("../src/lib/maplibre-assets");

// Shared with the mocked module below, which vi.resetModules() may rebuild.
const readFault = vi.hoisted(() => ({ code: undefined as string | undefined }));

// While readFault.code is set, reading a file fails the way Node reports a
// file the server user cannot read: a code, plus the absolute path in the
// message.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (readFault.code === undefined) return actual.readFileSync(...args);
    const filePath = String(args[0]);
    throw Object.assign(new Error(`${readFault.code}: open '${filePath}'`), {
      code: readFault.code,
      syscall: "open",
      path: filePath,
    });
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

const version = maplibrePackage.version;
const WORKER = `${version}/maplibre-gl-worker.mjs`;
const SHARED = `${version}/maplibre-gl-shared.mjs`;
// Matches the version allowlist (\d+) but exceeds the 255-byte name limit.
const LONG_SEGMENT = "9".repeat(300);

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

function fsErrorCode(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
  return undefined;
}

function writeAsset(relativePath: string): void {
  mkdirSync(path.dirname(path.join(assetRoot, relativePath)), { recursive: true });
  writeFileSync(path.join(assetRoot, relativePath), relativePath);
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
  readFault.code = undefined;
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

  it.each([
    ["major", `${LONG_SEGMENT}.0.0/maplibre-gl-worker.mjs`],
    ["minor", `0.${LONG_SEGMENT}.0/maplibre-gl-shared.mjs`],
    ["patch", `0.0.${LONG_SEGMENT}/maplibre-gl-worker.mjs.map`],
  ])(
    "stays silent for a %s version segment too long for the filesystem",
    (_part, relativePath) => {
      // Not vacuous: the path passes the allowlist and fails on the disk.
      expect(fsErrorCode(() => realpathSync(path.join(assetRoot, relativePath)))).toBe(
        "ENAMETOOLONG",
      );
      const rejected = serve("0.0.1/not-an-asset.mjs");

      for (let request = 0; request < 3; request += 1) {
        const response = serve(relativePath, { nodeEnv: "development" });
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(Object.fromEntries(response.headers)).toEqual(
          Object.fromEntries(rejected.headers),
        );
      }
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it("reports a repeated read error of an installed runtime asset once", () => {
    writeAsset(WORKER);
    readFault.code = "EACCES";

    for (let request = 0; request < 5; request += 1) {
      expect(serve(WORKER).status).toBe(404);
    }

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain(WORKER);
    expect(messages()[0]).toContain("EACCES");
    expect(messages()[0]).not.toContain(base);
  });

  it("reports a read error of the installed version once per code and path", () => {
    for (const relativePath of [WORKER, SHARED, `${WORKER}.map`]) writeAsset(relativePath);

    readFault.code = "EACCES";
    for (const relativePath of [WORKER, SHARED, WORKER, SHARED, `${WORKER}.map`, `${WORKER}.map`]) {
      expect(serve(relativePath, { nodeEnv: "development" }).status).toBe(404);
    }
    readFault.code = "EIO";
    for (const relativePath of [WORKER, WORKER]) {
      expect(serve(relativePath).status).toBe(404);
    }

    expect(messages()).toEqual([
      `[maplibre-assets] cannot serve ${WORKER}: EACCES`,
      `[maplibre-assets] cannot serve ${SHARED}: EACCES`,
      `[maplibre-assets] cannot serve ${WORKER}.map: EACCES`,
      `[maplibre-assets] cannot serve ${WORKER}: EIO`,
    ]);
  });

  it("reports a read error of other versions once per code, without the path", () => {
    const otherVersions = Array.from({ length: 6 }, (_, index) => `0.0.${index + 1}`);
    const otherAssets = otherVersions.flatMap((other) => [
      `${other}/maplibre-gl-worker.mjs`,
      `${other}/maplibre-gl-shared.mjs`,
    ]);
    for (const relativePath of otherAssets) writeAsset(relativePath);

    readFault.code = "EACCES";
    for (const relativePath of otherAssets) {
      expect(serve(relativePath).status).toBe(404);
    }
    expect(messages()).toHaveLength(1);

    readFault.code = "EIO";
    for (const relativePath of otherAssets.slice(0, 3)) {
      expect(serve(relativePath).status).toBe(404);
    }

    // Exact text: names only the installed version and the code, never one of
    // the requested versions, an asset name or the absolute path.
    expect(messages()).toEqual(
      ["EACCES", "EIO"].map(
        (code) =>
          "[maplibre-assets] cannot serve an asset of a MapLibre version other than " +
          `the installed ${version}: ${code}`,
      ),
    );
    for (const message of messages()) expect(message).not.toContain(base);
  });
});
