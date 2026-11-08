import { devices } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../playwright.config";
import { isBotUserAgent } from "../src/lib/bot-detect";

// The e2e server runs with the production .env, so every page the browser
// opens reports itself to /api/track, which writes a PageView row into the
// production database. The route skips bot user agents; Playwright traffic
// must announce itself as one. The real Chrome UA stays as a prefix so the
// pages render exactly as they do for a desktop Chrome visitor.
describe("playwright config", () => {
  const projects = config.projects ?? [];
  const chromeUserAgent = devices["Desktop Chrome"].userAgent;

  it("defines at least one project", () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  for (const project of projects) {
    describe(`project ${project.name ?? "(unnamed)"}`, () => {
      const userAgent = project.use?.userAgent;

      it("sends a user agent that /api/track skips as a bot", () => {
        expect(typeof userAgent).toBe("string");
        expect(isBotUserAgent(userAgent)).toBe(true);
      });

      it("keeps the Desktop Chrome user agent as its prefix", () => {
        expect(typeof userAgent).toBe("string");
        expect(userAgent!.startsWith(chromeUserAgent)).toBe(true);
      });
    });
  }
});

// On the production host 127.0.0.1:3000 is the live site, so a bare
// `npx playwright test` must never land there. Without BASE_URL the suite
// targets a local port of its own; anything else has to be asked for.
describe("playwright baseURL", () => {
  const originalBaseUrl = process.env.BASE_URL;

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = originalBaseUrl;
    vi.resetModules();
  });

  async function loadBaseUrl() {
    vi.resetModules();
    const { default: freshConfig } = await import("../playwright.config");
    return freshConfig.use?.baseURL;
  }

  it("defaults to a loopback port of its own, never the production :3000", async () => {
    delete process.env.BASE_URL;
    const baseUrl = await loadBaseUrl();
    expect(typeof baseUrl).toBe("string");
    const url = new URL(baseUrl!);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).not.toBe("3000");
    expect(Number(url.port)).toBeGreaterThanOrEqual(3200);
  });

  it("uses BASE_URL when it is set", async () => {
    process.env.BASE_URL = "http://127.0.0.1:3251";
    expect(await loadBaseUrl()).toBe("http://127.0.0.1:3251");
  });
});
