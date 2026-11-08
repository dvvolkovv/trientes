import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const fontFixturePath = fileURLToPath(
  new URL("fixtures/security-next-font.woff2", import.meta.url),
);

type FontAxes = {
  wght?: string[];
  ital?: string[];
  variableAxes?: [string, string][];
};

const { getFontAxes } = require(
  "next/dist/compiled/@next/font/dist/google/get-font-axes",
) as {
  getFontAxes: (
    family: string,
    weights: string[],
    styles: string[],
    selectedVariableAxes?: string[],
  ) => FontAxes;
};
const { getGoogleFontsUrl } = require(
  "next/dist/compiled/@next/font/dist/google/get-google-fonts-url",
) as {
  getGoogleFontsUrl: (family: string, axes: FontAxes, display: string) => string;
};

describe("Next Google Fonts public-loader build integration", () => {
  it("builds next/font/google with local mocked CSS and WOFF2 responses", async () => {
    const fixtureDirectory = mkdtempSync(
      path.join(repoRoot, "integration-tests/.next-font-extensionless-"),
    );
    const mockPath = path.join(fixtureDirectory, "mock-responses.json");
    const requests: string[] = [];
    const woff2 = readFileSync(fontFixturePath);
    expect(woff2.subarray(0, 4).toString("ascii")).toBe("wOF2");

    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.setHeader("Content-Type", "font/woff2");
      response.end(woff2);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;

      mkdirSync(path.join(fixtureDirectory, "app"), { recursive: true });
      writeFileSync(
        path.join(fixtureDirectory, "package.json"),
        JSON.stringify({ private: true }),
      );
      writeFileSync(
        path.join(fixtureDirectory, "next.config.mjs"),
        `export default { turbopack: { root: ${JSON.stringify(repoRoot)} } };\n`,
      );
      writeFileSync(
        path.join(fixtureDirectory, "app/layout.tsx"),
        `import { Inter } from "next/font/google";
const inter = Inter({
  weight: "400",
  style: "normal",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html className={inter.className}><body>{children}</body></html>;
}
`,
      );
      writeFileSync(
        path.join(fixtureDirectory, "app/page.tsx"),
        "export default function Page() { return <main>Font regression</main>; }\n",
      );

      const axes = getFontAxes("Inter", ["400"], ["normal"]);
      const googleFontsUrl = getGoogleFontsUrl("Inter", axes, "swap");
      const extensionlessFontPath = "/l/font?kit=x&amp;skey=y&amp;v=z";
      const extensionlessFontUrl = `http://127.0.0.1:${port}${extensionlessFontPath}`;
      const mockedCss = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${extensionlessFontUrl}) format('woff2');
}
`;
      expect(new URL(extensionlessFontUrl).hostname).toBe("127.0.0.1");
      expect(mockedCss).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      writeFileSync(mockPath, JSON.stringify({ [googleFontsUrl]: mockedCss }));

      const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
      expect(existsSync(nextBin)).toBe(true);
      const result = await execFileAsync(
        process.execPath,
        [nextBin, "build", fixtureDirectory],
        {
          encoding: "utf8",
          cwd: repoRoot,
          env: {
            ...process.env,
            CI: "1",
            NEXT_TELEMETRY_DISABLED: "1",
            NEXT_FONT_GOOGLE_MOCKED_RESPONSES: mockPath,
          },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 150_000,
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      expect(requests).toContain(extensionlessFontPath);
      expect(output).not.toContain("Failed to fetch");
    } finally {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

// This build proves the loader regression, not network isolation. Without an
// explicit non-loopback guard we report a skip rather than claim isolation PASS.
if (process.env.REQUIRE_NETWORK_GUARD === "1") {
  it("enforces the explicitly required non-loopback network guard", () => {
    throw new Error(
      "REQUIRE_NETWORK_GUARD=1 was requested, but no non-loopback guard is configured for this test; network isolation is not claimed.",
    );
  });
} else {
  it.skip(
    "non-loopback network guard (set REQUIRE_NETWORK_GUARD=1 to require an external guard)",
    () => {},
  );
}
