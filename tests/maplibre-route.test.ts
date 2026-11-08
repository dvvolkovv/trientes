import { readFileSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { describe, expect, it } from "vitest";
import { GET } from "../src/app/maplibre/[...path]/route";

const root = path.resolve(__dirname, "..");
const version = maplibrePackage.version;

function requestAsset(segments: string[]): Promise<Response> {
  return GET(new Request("http://localhost/maplibre/asset"), {
    params: Promise.resolve({ path: segments }),
  });
}

describe("MapLibre asset route cache policy", () => {
  it.each([
    [version, "maplibre-gl-worker.mjs"],
    [version, "maplibre-gl-shared.mjs"],
    ["maplibre-gl-worker.mjs"],
    ["maplibre-gl-shared.mjs"],
  ])("serves %s with immutable caching", async (...segments: string[]) => {
    const response = await requestAsset(segments);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("content-type")).toContain("text/javascript");
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(body.byteLength));
    expect(
      body.equals(
        readFileSync(
          path.join(root, "node_modules/maplibre-gl/dist", segments.at(-1)!),
        ),
      ),
    ).toBe(true);
  });

  it.each([
    [version, "missing.mjs"],
    ["..", "package.json"],
    ["/etc", "passwd"],
    ["%2e%2e", "package.json"],
  ])("returns no-store for missing or unsafe path %s", async (...segments: string[]) => {
    const response = await requestAsset(segments);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a symlink that escapes the generated root", async () => {
    const link = path.join(root, "public/maplibre/route-test-escape.mjs");
    try {
      symlinkSync(path.join(root, "package.json"), link);
      const response = await requestAsset(["route-test-escape.mjs"]);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      rmSync(link, { force: true });
    }
  });


  it("scopes immutable headers to successful runtime static assets", async () => {
    const { default: config } = await import("../next.config");
    const headers = await config.headers?.();
    expect(headers).toEqual([
      {
        source: "/maplibre/:version(\\d+\\.\\d+\\.\\d+)/:asset(maplibre-gl-(?:worker|shared)\\.mjs)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/maplibre/:asset(maplibre-gl-(?:worker|shared)\\.mjs)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]);
  });
});
