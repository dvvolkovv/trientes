import nextPackage from "next/package.json";
import { describe, expect, it } from "vitest";

function isFixedNextRelease(version: string): boolean {
  const [major, minor, patch] = version.split(".").map(Number);
  return (
    major > 16 ||
    (major === 16 &&
      (minor > 3 || (minor === 3 && patch >= 6)))
  );
}

describe("next/og GHSA-vcvr-r3jv-pc5j release floor", () => {
  it("uses a Next release containing the SVG data-flow fix", () => {
    // This is intentionally a version guard, not an exploit PoC. The audit
    // evidence complements it; no user-controlled SVG exploit is executed.
    expect(isFixedNextRelease(nextPackage.version)).toBe(true);
  });
});
