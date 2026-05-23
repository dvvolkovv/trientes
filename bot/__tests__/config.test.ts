import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config";

const REQUIRED: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "tok",
  TELEGRAM_WEBHOOK_SECRET: "sec",
  OPENAI_API_KEY: "sk-x",
  BOT_ALLOWED_USER_IDS: "111,222",
  CLAUDE_CWD: "/home/dv/trientes",
};

describe("loadConfig", () => {
  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = { ...process.env };
    for (const k of Object.keys(REQUIRED)) delete process.env[k];
    delete process.env.BOT_PORT;
    delete process.env.CLAUDE_TIMEOUT_MS;
    delete process.env.REDIS_URL;
    delete process.env.GITHUB_REPO_URL;
  });

  afterEach(() => {
    process.env = original;
  });

  it("loads required + defaults", () => {
    Object.assign(process.env, REQUIRED);
    const cfg = loadConfig();
    expect(cfg.telegramBotToken).toBe("tok");
    expect(cfg.telegramWebhookSecret).toBe("sec");
    expect(cfg.openaiApiKey).toBe("sk-x");
    expect(cfg.claudeCwd).toBe("/home/dv/trientes");
    expect(cfg.allowedUserIds).toEqual(new Set([111, 222]));
    expect(cfg.botPort).toBe(4100);
    expect(cfg.claudeTimeoutMs).toBe(1_800_000);
    expect(cfg.redisUrl).toBe("redis://127.0.0.1:6379");
    expect(cfg.githubRepoUrl).toBe("https://github.com/dvvolkovv/trientes");
  });

  it("respects overrides", () => {
    Object.assign(process.env, REQUIRED, {
      BOT_PORT: "5000",
      CLAUDE_TIMEOUT_MS: "120000",
      REDIS_URL: "redis://foo:6380",
      GITHUB_REPO_URL: "https://github.com/x/y",
    });
    const cfg = loadConfig();
    expect(cfg.botPort).toBe(5000);
    expect(cfg.claudeTimeoutMs).toBe(120_000);
    expect(cfg.redisUrl).toBe("redis://foo:6380");
    expect(cfg.githubRepoUrl).toBe("https://github.com/x/y");
  });

  it("throws if required var missing", () => {
    Object.assign(process.env, REQUIRED);
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("allows empty allowedUserIds", () => {
    Object.assign(process.env, REQUIRED, { BOT_ALLOWED_USER_IDS: "" });
    const cfg = loadConfig();
    expect(cfg.allowedUserIds.size).toBe(0);
  });

  it("ignores blanks in allowedUserIds", () => {
    Object.assign(process.env, REQUIRED, { BOT_ALLOWED_USER_IDS: "111, ,222" });
    const cfg = loadConfig();
    expect(cfg.allowedUserIds).toEqual(new Set([111, 222]));
  });
});
