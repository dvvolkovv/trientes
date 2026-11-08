import { devices } from "@playwright/test";
import { describe, expect, it } from "vitest";
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
