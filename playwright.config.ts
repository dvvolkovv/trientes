import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  fullyParallel: true,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    // 127.0.0.1:3000 is the live site on the production host. Without
    // BASE_URL the suite expects its own server on :3200, e.g.
    // `npx next start -p 3200`; for a local dev server pass
    // BASE_URL=http://localhost:3000 explicitly.
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        // The e2e server runs with the production .env, and /api/track writes a
        // PageView row for every page the browser opens. The "Playwright" token
        // makes isBotUserAgent() skip it; the Chrome UA stays as the prefix so
        // pages render exactly as for a desktop Chrome visitor.
        userAgent: `${devices["Desktop Chrome"].userAgent} trientes-e2e Playwright`,
      },
    },
  ],
});
