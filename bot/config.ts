import type { Config } from "./types";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) {
          throw new Error(`BOT_ALLOWED_USER_IDS contains non-integer: ${s}`);
        }
        return n;
      }),
  );
}

export function loadConfig(): Config {
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
    openaiApiKey: required("OPENAI_API_KEY"),
    claudeCwd: required("CLAUDE_CWD"),
    allowedUserIds: parseIds(process.env.BOT_ALLOWED_USER_IDS ?? ""),
    botPort: Number(process.env.BOT_PORT ?? 4100),
    claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS ?? 1_800_000), // 30 min — long builds/tests/browser runs need headroom
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    githubRepoUrl:
      process.env.GITHUB_REPO_URL ?? "https://github.com/dvvolkovv/trientes",
  };
}
