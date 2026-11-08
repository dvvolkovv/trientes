import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
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

type FontBuildError = Error & {
  code?: number | string;
  stdout?: string;
  stderr?: string;
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

describe("Next Google Fonts extensionless URL regression", () => {
  it(
    "builds an extensionless woff2 URL using only mocked and local responses",
    { timeout: 180_000 },
    async () => {
      const fixtureDir = mkdtempSync(
        join(repoRoot, "tests", ".next-font-extensionless-"),
      );
      const mockPath = join(fixtureDir, "mock-responses.json");
      const requests: string[] = [];
      // Real Fraunces WOFF2 from the official Next.js font e2e fixture.
      const mockWoff2 = readFileSync(fontFixturePath);
      expect(mockWoff2.subarray(0, 4).toString("ascii")).toBe("wOF2");
      const server = createServer((request, response) => {
        requests.push(request.url ?? "");
        response.setHeader("Content-Type", "font/woff2");
        response.end(mockWoff2);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const { port } = server.address() as AddressInfo;

        mkdirSync(join(fixtureDir, "app"), { recursive: true });
        writeFileSync(
          join(fixtureDir, "package.json"),
          JSON.stringify({ private: true }),
        );
        writeFileSync(
          join(fixtureDir, "next.config.mjs"),
          `export default { turbopack: { root: ${JSON.stringify(repoRoot)} } };\n`,
        );
        writeFileSync(
          join(fixtureDir, "app", "layout.tsx"),
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
          join(fixtureDir, "app", "page.tsx"),
          'export default function Page() { return <main>Font regression</main>; }\n',
        );

        const axes = getFontAxes("Inter", ["400"], ["normal"]);
        const googleFontsUrl = getGoogleFontsUrl("Inter", axes, "swap");
        const extensionlessFontPath = "/l/font?kit=x&amp;skey=y&amp;v=z";
        const extensionlessFontUrl =
          `http://127.0.0.1:${port}${extensionlessFontPath}`;
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

        const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
        const tracePath = join(fixtureDir, "network-connections.trace");
        const straceBin = "/usr/bin/strace";
        const traceNetwork = process.platform === "linux" && existsSync(straceBin);
        const command = traceNetwork ? straceBin : process.execPath;
        const commandArgs = traceNetwork
          ? [
              "-f",
              "-qq",
              "-e",
              "trace=connect",
              "-o",
              tracePath,
              process.execPath,
              nextBin,
              "build",
              fixtureDir,
            ]
          : [nextBin, "build", fixtureDir];
        let status = 0;
        let output = "";
        try {
          const result = await execFileAsync(command, commandArgs, {
            encoding: "utf8",
            env: {
              ...process.env,
              CI: "1",
              NEXT_TELEMETRY_DISABLED: "1",
              NEXT_FONT_GOOGLE_MOCKED_RESPONSES: mockPath,
            },
            maxBuffer: 10 * 1024 * 1024,
            timeout: 150_000,
          });
          output = `${result.stdout}\n${result.stderr}`;
        } catch (error) {
          const buildError = error as FontBuildError;
          status = typeof buildError.code === "number" ? buildError.code : 1;
          output = `${buildError.stdout ?? ""}\n${buildError.stderr ?? ""}`;
        }

        const nonLoopbackConnections = traceNetwork
          ? readFileSync(tracePath, "utf8")
              .split("\n")
              .filter((line) => {
                if (!line.includes("connect(")) return false;
                const ipv4 = /inet_addr\("([^"]+)"\)/.exec(line);
                if (ipv4) return !ipv4[1].startsWith("127.");
                if (line.includes("sin6_addr=")) {
                  return !line.includes('"::1"') &&
                    !line.includes('"::ffff:127.');
                }
                return false;
              })
          : [];

        console.log(`[security-font] mocked CSS URL: ${googleFontsUrl}`);
        console.log(`[security-font] local WOFF2 URL: ${extensionlessFontUrl}`);
        console.log(`[security-font] local WOFF2 bytes: ${mockWoff2.length}`);
        console.log(`[security-font] local requests: ${JSON.stringify(requests)}`);
        console.log(
          `[security-font] non-loopback connections: ${nonLoopbackConnections.length}`,
        );
        console.log(
          `[security-font] network evidence: ${traceNetwork ? "strace connect" : "local URL assertions"}`,
        );

        expect(status, output).toBe(0);
        expect(requests).toContain(extensionlessFontPath);
        expect(nonLoopbackConnections).toEqual([]);
        expect(output).not.toContain("Failed to fetch");
      } finally {
        if (server.listening) {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        }
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    },
  );
});
