import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

/** `git check-ignore` exit status: 0 ignored, 1 not ignored. */
function isIgnored(relativePath: string): boolean {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", relativePath],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr}`);
  }
  return result.status === 0;
}

describe.skipIf(!existsSync(path.join(root, ".git")))(
  "generated files stay out of git",
  () => {
    it.each([
      ".generated/maplibre/6.4.1/maplibre-gl-worker.mjs",
      ".generated/maplibre/6.4.1/maplibre-gl-worker.mjs.map",
      // Turbopack only compiles inside its root, so the next/font build
      // fixture has to live in the repository; an interrupted run leaves it.
      "integration-tests/.next-font-extensionless-AbC123/app/page.tsx",
      "integration-tests/.next-font-extensionless-AbC123/.next/BUILD_ID",
    ])("ignores %s", (relativePath) => {
      expect(isIgnored(relativePath)).toBe(true);
    });

    it.each([
      "integration-tests/security-next-font-build.test.ts",
      "integration-tests/fixtures/security-next-font.woff2",
      "scripts/copy-maplibre-worker.mjs",
    ])("keeps %s tracked", (relativePath) => {
      expect(isIgnored(relativePath)).toBe(false);
    });
  },
);
