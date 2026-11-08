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

// major.minor.patch only: every version and range compared here has that form.
function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`not a major.minor.patch version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(version: string, minimum: string): boolean {
  const left = parseVersion(version);
  const right = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

/** Lower bound of a `>=x.y.z` or `^x.y.z` range, the only forms used here. */
function lowerBound(range: string): string {
  const match = /^(?:>=|\^)\s*(\d+\.\d+\.\d+)$/.exec(range.trim());
  if (!match) throw new Error(`unsupported version range: ${range}`);
  return match[1];
}

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

  it("compares versions numerically, not as strings", () => {
    expect(atLeast("6.16.10", "6.16.2")).toBe(true);
    expect(atLeast("6.9.0", "6.16.2")).toBe(false);
    expect(atLeast("4.22.3", "4.22.3")).toBe(true);
    expect(atLeast("4.22.2", "4.22.3")).toBe(false);
    expect(lowerBound("^4.22.3")).toBe("4.22.3");
    expect(lowerBound(">=22.12.0")).toBe("22.12.0");
    expect(() => lowerBound("~4.22.3")).toThrow();
  });

  // Dependency hygiene rather than an exploitable path: the three qs advisories
  // (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw) are not
  // reachable through qs.parse with the options Express 4 passes, and
  // bot/webhook.ts never reads req.query. Express 4.22.3 asks for qs ~6.16.0
  // itself, so no override is needed to keep every qs on a fixed release.
  it("resolves qs 6.16.2 or later through express 4.22.3 without an override", () => {
    expect(manifest.overrides).not.toHaveProperty("express");
    expect(atLeast(lowerBound(manifest.dependencies.express), "4.22.3")).toBe(true);
    const express = lock.packages["node_modules/express"].version;
    expect(atLeast(express, "4.22.3"), express).toBe(true);

    const qsEntries = Object.entries(lock.packages).filter(([key]) =>
      /(^|\/)node_modules\/qs$/.test(key),
    );
    expect(qsEntries.length).toBeGreaterThan(0);
    for (const [key, entry] of qsEntries) {
      const { version } = entry as { version: string };
      expect(atLeast(version, "6.16.2"), `${key} ${version}`).toBe(true);
    }
  });
});
