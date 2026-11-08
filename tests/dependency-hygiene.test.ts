import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const lock = JSON.parse(
  readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

describe("dependency lockfile hygiene", () => {
  it.each([
    "@playwright/test",
    "playwright",
    "playwright-core",
    "prisma",
    "@prisma/debug",
    "@prisma/engines",
    "@prisma/engines-version",
    "@prisma/fetch-engine",
    "@prisma/get-platform",
    "@types/react",
    "@types/react-dom",
    "csstype",
  ])("marks %s as development-only", (packageName) => {
    const entry = lock.packages[`node_modules/${packageName}`];
    expect(entry.dev, packageName).toBe(true);
    expect(entry.devOptional, packageName).not.toBe(true);
  });

  it("keeps micromatch on its compatible picomatch major", () => {
    expect(manifest.overrides.picomatch).toBe("4.0.4");
    expect(manifest.overrides.micromatch.picomatch).toBe("2.3.2");
    expect(lock.packages["node_modules/picomatch"].version).toBe("4.0.4");
    expect(
      lock.packages["node_modules/micromatch/node_modules/picomatch"].version,
    ).toBe("2.3.2");
  });
});
