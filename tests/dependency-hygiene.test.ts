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
  ])("marks %s as development-only", (packageName) => {
    const entry = lock.packages[`node_modules/${packageName}`];
    expect(entry.dev, packageName).toBe(true);
    expect(entry.devOptional, packageName).not.toBe(true);
  });

  // These type-only packages are also optional peers of runtime dependencies
  // (@radix-ui/*, react-remove-scroll, ...), so the canonical
  // `npm install --package-lock-only` output marks them devOptional rather
  // than dev. Accept either flag; neither carries runtime code.
  it.each(["@types/react", "@types/react-dom", "csstype"])(
    "marks type-only %s as dev or devOptional",
    (packageName) => {
      const entry = lock.packages[`node_modules/${packageName}`];
      expect(entry.dev === true || entry.devOptional === true, packageName).toBe(
        true,
      );
    },
  );

  it("keeps micromatch on its compatible picomatch major", () => {
    expect(manifest.overrides.picomatch).toBe("4.0.4");
    expect(manifest.overrides.micromatch.picomatch).toBe("2.3.2");
    expect(lock.packages["node_modules/picomatch"].version).toBe("4.0.4");
    expect(
      lock.packages["node_modules/micromatch/node_modules/picomatch"].version,
    ).toBe("2.3.2");
  });

  // express@4.22 asks for qs ~6.15.1, which resolved to 6.15.2
  // (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw). Its query
  // parser runs on every bot webhook request, so it must use the same fixed
  // qs as the overridden body-parser.
  it("pins qs 6.16.2 for express", () => {
    expect(manifest.overrides.express?.qs).toBe("6.16.2");
    const qsEntries = Object.entries(lock.packages).filter(([key]) =>
      /(^|\/)node_modules\/qs$/.test(key),
    );
    expect(qsEntries.length).toBeGreaterThan(0);
    for (const [key, entry] of qsEntries) {
      expect((entry as { version: string }).version, key).toBe("6.16.2");
    }
  });
});
