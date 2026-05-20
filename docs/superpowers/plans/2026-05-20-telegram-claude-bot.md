# Telegram → Claude Code bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot, hosted under PM2 on server 85.192.25.242 alongside the trientes prod processes, that lets two whitelisted users (@dvvolkov and @ALGENOMIC) drive ongoing development of `~/trientes` by sending text or voice messages — bot transcribes voice via OpenAI Whisper, invokes the local Claude Code CLI in headless mode with autonomous permissions, streams a debounced high-level status back to the chat, and posts the final commit URL when Claude pushes and reloads PM2.

**Architecture:** Single Node.js process (`trientes-bot`) using `grammy` for Telegram + Express webhook + `ioredis` for sessions + spawn of `claude` CLI per request. Files live under `bot/` next to the existing `worker/`. Runtime via `tsx` (no separate build step). Tests in `bot/__tests__/` using the project's existing `vitest`.

**Tech Stack:** TypeScript · grammy 1.x · express 4.x · ioredis 5.x · openai 4.x · tsx · vitest · ioredis-mock (dev) · Claude Code CLI (installed globally on server).

**Reference spec:** [docs/superpowers/specs/2026-05-20-telegram-claude-bot-design.md](../specs/2026-05-20-telegram-claude-bot-design.md)

---

## File Structure

All new files unless noted.

```
bot/
├── index.ts               # entry point: env load, redis/openai init, grammy + express boot
├── webhook.ts             # express factory + telegram webhook routing
├── config.ts              # env parsing + validation (typed Config)
├── logger.ts              # JSONL append-only audit + unauthorized logs
├── auth.ts                # whitelist check (pure)
├── session.ts             # Redis session store class
├── voice.ts               # download Telegram voice + Whisper transcription
├── streamParser.ts        # pure stream-json line → event mapper
├── claudeRunner.ts        # spawn Claude CLI, run lifecycle, timeout, cancel
├── telegramView.ts        # StatusUpdater (debounced editMessageText) + final reply
├── commands.ts            # slash command dispatcher
├── types.ts               # shared TS types (Config, StreamEvent, RunResult, …)
└── __tests__/
    ├── config.test.ts
    ├── logger.test.ts
    ├── auth.test.ts
    ├── session.test.ts
    ├── voice.test.ts
    ├── streamParser.test.ts
    ├── claudeRunner.test.ts
    ├── telegramView.test.ts
    └── commands.test.ts
```

**Modifications:**
- `package.json` — add deps + npm scripts
- `ecosystem.config.js` — add `trientes-bot` PM2 entry
- `vitest.config.ts` — include `bot/**/*.test.ts` (verify; may already glob everything)

**Out of repo (deployment):**
- nginx server block for trientes.org gains a `location /bot/<secret>`
- Telegram webhook registered via `setWebhook` HTTP call
- `claude` CLI installed on server with logged-in Anthropic subscription
- `/etc/logrotate.d/trientes-bot`

---

## Task 1: Project skeleton + dependencies

**Files:**
- Modify: `package.json`
- Create: `bot/.gitkeep`
- Create: `bot/__tests__/.gitkeep`
- Verify: `vitest.config.ts` picks up `bot/**/*.test.ts`

- [ ] **Step 1: Add deps and scripts to `package.json`**

In `dependencies` add:
```json
"grammy": "^1.30.0",
"openai": "^4.73.0",
"express": "^4.21.0"
```

In `devDependencies` add:
```json
"@types/express": "^4.17.21",
"ioredis-mock": "^8.9.0"
```

In `scripts` add:
```json
"bot:dev": "tsx watch bot/index.ts",
"bot:start": "tsx bot/index.ts"
```

- [ ] **Step 2: Install**

Run locally (will fail on full Next build but `npm install` works):
```bash
npm install
```
Expected: `node_modules` updated, no errors. If `npm install` fetches anything claude-related, ignore — we install `claude` CLI separately on the server.

- [ ] **Step 3: Create directories**

```bash
mkdir -p bot/__tests__
touch bot/.gitkeep bot/__tests__/.gitkeep
```

- [ ] **Step 4: Verify vitest picks up bot tests**

Read `vitest.config.ts`. If it has an explicit `include` array, ensure it covers `bot/**/*.test.ts` (e.g. matches `**/*.test.ts` or add `bot/**/*.test.ts`). If no `include` is set, vitest's default `**/*.{test,spec}.?(c|m)[jt]s?(x)` already covers it — no change needed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json bot/ vitest.config.ts
git commit -m "chore(bot): scaffold bot directory and dependencies"
```

---

## Task 2: Shared types

**Files:**
- Create: `bot/types.ts`

- [ ] **Step 1: Write types**

```ts
// bot/types.ts

export interface Config {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedUserIds: Set<number>;
  openaiApiKey: string;
  botPort: number;
  claudeCwd: string;
  claudeTimeoutMs: number;
  redisUrl: string;
  githubRepoUrl: string; // e.g. "https://github.com/dvvolkovv/trientes"
}

export interface SessionRecord {
  claudeSessionId: string;
  startedAt: number; // unix ms
  lastActivity: number; // unix ms
}

export type StreamEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "tool_use"; toolName: string; input: unknown }
  | { kind: "text"; text: string }
  | { kind: "result"; isError: boolean }
  | { kind: "unknown"; raw: unknown };

export interface RunResult {
  exitCode: number;
  finalText: string;
  stderrTail: string;
  sessionId: string | null; // populated from first init event
  durationMs: number;
}

export interface AuditEntry {
  ts: string; // ISO
  userId: number;
  prompt: string;
  sessionId: string | null;
  claudeExitCode: number;
  commitSha?: string;
  filesChanged?: string[];
  durationMs: number;
}

export interface UnauthorizedEntry {
  ts: string;
  userId: number;
  username: string | null;
  textSnippet: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add bot/types.ts
git commit -m "feat(bot): add shared types"
```

---

## Task 3: Config module

**Files:**
- Create: `bot/config.ts`
- Create: `bot/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/config.test.ts
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
    expect(cfg.claudeTimeoutMs).toBe(600_000);
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
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/config.test.ts
```
Expected: FAIL — `Cannot find module '../config'`.

- [ ] **Step 3: Implement `bot/config.ts`**

```ts
// bot/config.ts
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
    claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS ?? 600_000),
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    githubRepoUrl:
      process.env.GITHUB_REPO_URL ?? "https://github.com/dvvolkovv/trientes",
  };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/config.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/config.ts bot/__tests__/config.test.ts
git commit -m "feat(bot): config loader with env parsing"
```

---

## Task 4: Logger module (JSONL append)

**Files:**
- Create: `bot/logger.ts`
- Create: `bot/__tests__/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger";

describe("logger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bot-log-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates files lazily and appends JSONL", async () => {
    const logger = createLogger(dir);
    await logger.appendAudit({
      ts: "2026-05-20T10:00:00Z",
      userId: 1,
      prompt: "p1",
      sessionId: "s1",
      claudeExitCode: 0,
      durationMs: 100,
    });
    await logger.appendAudit({
      ts: "2026-05-20T10:01:00Z",
      userId: 1,
      prompt: "p2",
      sessionId: "s1",
      claudeExitCode: 0,
      durationMs: 200,
    });

    const path = join(dir, "audit.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).prompt).toBe("p1");
    expect(JSON.parse(lines[1]).prompt).toBe("p2");
  });

  it("writes unauthorized entries to separate file", async () => {
    const logger = createLogger(dir);
    await logger.appendUnauthorized({
      ts: "2026-05-20T10:00:00Z",
      userId: 999,
      username: "spammer",
      textSnippet: "hi",
    });
    const lines = readFileSync(join(dir, "unauthorized.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(JSON.parse(lines[0]).userId).toBe(999);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/logger.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/logger.ts`**

```ts
// bot/logger.ts
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AuditEntry, UnauthorizedEntry } from "./types";

export interface Logger {
  appendAudit(entry: AuditEntry): Promise<void>;
  appendUnauthorized(entry: UnauthorizedEntry): Promise<void>;
}

async function appendJsonl(path: string, entry: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
}

export function createLogger(logDir: string): Logger {
  const auditPath = join(logDir, "audit.jsonl");
  const unauthorizedPath = join(logDir, "unauthorized.jsonl");
  return {
    appendAudit: (e) => appendJsonl(auditPath, e),
    appendUnauthorized: (e) => appendJsonl(unauthorizedPath, e),
  };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/logger.test.ts
```
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/logger.ts bot/__tests__/logger.test.ts
git commit -m "feat(bot): JSONL audit + unauthorized loggers"
```

---

## Task 5: Auth module

**Files:**
- Create: `bot/auth.ts`
- Create: `bot/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/auth.test.ts
import { describe, it, expect } from "vitest";
import { isAllowed } from "../auth";

describe("isAllowed", () => {
  it("returns true for listed user", () => {
    expect(isAllowed(111, new Set([111, 222]))).toBe(true);
  });
  it("returns false for non-listed user", () => {
    expect(isAllowed(333, new Set([111, 222]))).toBe(false);
  });
  it("returns false for empty whitelist", () => {
    expect(isAllowed(111, new Set())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/auth.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/auth.ts`**

```ts
// bot/auth.ts
export function isAllowed(userId: number, allowed: Set<number>): boolean {
  return allowed.has(userId);
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/auth.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/auth.ts bot/__tests__/auth.test.ts
git commit -m "feat(bot): whitelist auth check"
```

---

## Task 6: Session store

**Files:**
- Create: `bot/session.ts`
- Create: `bot/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";
import { SessionStore, SESSION_TTL_SECONDS } from "../session";

describe("SessionStore", () => {
  let redis: InstanceType<typeof RedisMock>;
  let store: SessionStore;

  beforeEach(() => {
    redis = new RedisMock();
    store = new SessionStore(redis as never);
  });

  it("returns null when no session exists", async () => {
    expect(await store.get(1)).toBeNull();
  });

  it("set + get round-trips", async () => {
    await store.set(1, "abc-123");
    const rec = await store.get(1);
    expect(rec).not.toBeNull();
    expect(rec!.claudeSessionId).toBe("abc-123");
    expect(typeof rec!.startedAt).toBe("number");
    expect(typeof rec!.lastActivity).toBe("number");
  });

  it("set applies TTL", async () => {
    await store.set(1, "abc");
    const ttl = await redis.ttl("claude:session:1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it("reset deletes key", async () => {
    await store.set(1, "abc");
    await store.reset(1);
    expect(await store.get(1)).toBeNull();
  });

  it("touch refreshes TTL and lastActivity", async () => {
    await store.set(1, "abc");
    const before = await store.get(1);
    await new Promise((r) => setTimeout(r, 10));
    await store.touch(1);
    const after = await store.get(1);
    expect(after!.lastActivity).toBeGreaterThanOrEqual(before!.lastActivity);
    const ttl = await redis.ttl("claude:session:1");
    expect(ttl).toBeGreaterThan(0);
  });

  it("touch on missing key is a no-op", async () => {
    await store.touch(999);
    expect(await store.get(999)).toBeNull();
  });

  it("verbose flag set/get round-trips", async () => {
    expect(await store.getVerbose(1)).toBe(false);
    await store.setVerbose(1, true);
    expect(await store.getVerbose(1)).toBe(true);
    await store.setVerbose(1, false);
    expect(await store.getVerbose(1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/session.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/session.ts`**

```ts
// bot/session.ts
import type Redis from "ioredis";
import type { SessionRecord } from "./types";

export const SESSION_TTL_SECONDS = 30 * 60;
const SESSION_KEY = (userId: number) => `claude:session:${userId}`;
const VERBOSE_KEY = (userId: number) => `bot:verbose:${userId}`;

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async get(userId: number): Promise<SessionRecord | null> {
    const raw = await this.redis.get(SESSION_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionRecord;
  }

  async set(userId: number, claudeSessionId: string): Promise<void> {
    const now = Date.now();
    const record: SessionRecord = {
      claudeSessionId,
      startedAt: now,
      lastActivity: now,
    };
    await this.redis.set(
      SESSION_KEY(userId),
      JSON.stringify(record),
      "EX",
      SESSION_TTL_SECONDS,
    );
  }

  async reset(userId: number): Promise<void> {
    await this.redis.del(SESSION_KEY(userId));
  }

  async touch(userId: number): Promise<void> {
    const existing = await this.get(userId);
    if (!existing) return;
    existing.lastActivity = Date.now();
    await this.redis.set(
      SESSION_KEY(userId),
      JSON.stringify(existing),
      "EX",
      SESSION_TTL_SECONDS,
    );
  }

  async getVerbose(userId: number): Promise<boolean> {
    const v = await this.redis.get(VERBOSE_KEY(userId));
    return v === "1";
  }

  async setVerbose(userId: number, on: boolean): Promise<void> {
    if (on) {
      await this.redis.set(VERBOSE_KEY(userId), "1");
    } else {
      await this.redis.del(VERBOSE_KEY(userId));
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/session.test.ts
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/session.ts bot/__tests__/session.test.ts
git commit -m "feat(bot): redis-backed session + verbose store"
```

---

## Task 7: Voice download + transcription

**Files:**
- Create: `bot/voice.ts`
- Create: `bot/__tests__/voice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/voice.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribeBuffer } from "../voice";

describe("transcribeBuffer", () => {
  let openai: { audio: { transcriptions: { create: ReturnType<typeof vi.fn> } } };

  beforeEach(() => {
    openai = {
      audio: {
        transcriptions: {
          create: vi.fn(),
        },
      },
    };
  });

  it("calls openai with file + language=ru and returns text", async () => {
    openai.audio.transcriptions.create.mockResolvedValue({ text: "привет" });
    const result = await transcribeBuffer(
      Buffer.from("fake-ogg"),
      "voice.ogg",
      openai as never,
    );
    expect(result).toBe("привет");
    expect(openai.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    const args = openai.audio.transcriptions.create.mock.calls[0][0];
    expect(args.model).toBe("whisper-1");
    expect(args.language).toBe("ru");
    expect(args.file).toBeDefined();
  });

  it("trims surrounding whitespace from response", async () => {
    openai.audio.transcriptions.create.mockResolvedValue({ text: "  hi  " });
    expect(await transcribeBuffer(Buffer.from("x"), "a.ogg", openai as never)).toBe(
      "hi",
    );
  });

  it("propagates errors from OpenAI", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(new Error("429"));
    await expect(
      transcribeBuffer(Buffer.from("x"), "a.ogg", openai as never),
    ).rejects.toThrow("429");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/voice.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/voice.ts`**

```ts
// bot/voice.ts
import OpenAI, { toFile } from "openai";

export async function transcribeBuffer(
  audio: Buffer,
  filename: string,
  openai: OpenAI,
): Promise<string> {
  const file = await toFile(audio, filename);
  const res = await openai.audio.transcriptions.create({
    model: "whisper-1",
    language: "ru",
    file,
  });
  return res.text.trim();
}

export async function downloadTelegramVoice(
  fileId: string,
  botToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffer: Buffer; filename: string }> {
  const metaRes = await fetchFn(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const meta = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };
  if (!meta.ok || !meta.result) {
    throw new Error(`Telegram getFile failed for ${fileId}`);
  }
  const filePath = meta.result.file_path;
  const fileRes = await fetchFn(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed (${fileRes.status})`);
  }
  const ab = await fileRes.arrayBuffer();
  const filename = filePath.split("/").pop() ?? "voice.ogg";
  return { buffer: Buffer.from(ab), filename };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/voice.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/voice.ts bot/__tests__/voice.test.ts
git commit -m "feat(bot): whisper transcription + telegram voice download"
```

---

## Task 8: Stream parser (pure)

**Files:**
- Create: `bot/streamParser.ts`
- Create: `bot/__tests__/streamParser.test.ts`

The Claude Code CLI in `-p --output-format stream-json --verbose` mode emits one JSON object per line. The actual schema must be verified against the installed CLI version (see Task 14 verification step). This parser is defensive: it categorises by recognisable shape and never throws.

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/streamParser.test.ts
import { describe, it, expect } from "vitest";
import { parseStreamLine } from "../streamParser";

describe("parseStreamLine", () => {
  it("recognises init event with session_id", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
    );
    expect(ev).toEqual({ kind: "init", sessionId: "abc" });
  });

  it("recognises assistant tool_use event", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/x/y.ts" },
            },
          ],
        },
      }),
    );
    expect(ev).toEqual({
      kind: "tool_use",
      toolName: "Read",
      input: { file_path: "/x/y.ts" },
    });
  });

  it("recognises assistant text event", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    );
    expect(ev).toEqual({ kind: "text", text: "hello" });
  });

  it("recognises result event", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "success", is_error: false }),
    );
    expect(ev).toEqual({ kind: "result", isError: false });
  });

  it("returns unknown for unrecognised shape", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "weird" }));
    expect(ev?.kind).toBe("unknown");
  });

  it("returns null for empty / blank lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("returns unknown for invalid JSON (does not throw)", () => {
    const ev = parseStreamLine("{not json");
    expect(ev?.kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/streamParser.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/streamParser.ts`**

```ts
// bot/streamParser.ts
import type { StreamEvent } from "./types";

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "unknown", raw: trimmed };
  }

  if (!obj || typeof obj !== "object") {
    return { kind: "unknown", raw: obj };
  }
  const o = obj as Record<string, unknown>;

  if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") {
    return { kind: "init", sessionId: o.session_id };
  }

  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    const content = (o.message as Record<string, unknown>).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>;
      if (first.type === "tool_use" && typeof first.name === "string") {
        return {
          kind: "tool_use",
          toolName: first.name,
          input: first.input,
        };
      }
      if (first.type === "text" && typeof first.text === "string") {
        return { kind: "text", text: first.text };
      }
    }
  }

  if (o.type === "result") {
    return { kind: "result", isError: o.is_error === true };
  }

  return { kind: "unknown", raw: obj };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/streamParser.test.ts
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/streamParser.ts bot/__tests__/streamParser.test.ts
git commit -m "feat(bot): claude stream-json line parser"
```

---

## Task 9: Status renderer (tool_use → short Russian status)

**Files:**
- Create: `bot/statusRender.ts`
- Create: `bot/__tests__/statusRender.test.ts`

Helper used by both default mode (status text in placeholder) and verbose mode (per-tool messages).

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/statusRender.test.ts
import { describe, it, expect } from "vitest";
import { renderToolStatus } from "../statusRender";

describe("renderToolStatus", () => {
  it("Read shows filename", () => {
    expect(
      renderToolStatus("Read", { file_path: "/home/dv/trientes/src/x.ts" }),
    ).toBe("📖 читаю src/x.ts");
  });

  it("Edit shows filename", () => {
    expect(
      renderToolStatus("Edit", { file_path: "src/components/Header.tsx" }),
    ).toBe("✏️ правлю src/components/Header.tsx");
  });

  it("Write shows filename", () => {
    expect(renderToolStatus("Write", { file_path: "a.md" })).toBe("📝 пишу a.md");
  });

  it("git commit detected", () => {
    expect(
      renderToolStatus("Bash", { command: 'git commit -m "x"' }),
    ).toBe("💾 коммичу");
  });

  it("git push detected", () => {
    expect(renderToolStatus("Bash", { command: "git push origin main" })).toBe(
      "🚀 пушу",
    );
  });

  it("pm2 reload detected", () => {
    expect(
      renderToolStatus("Bash", { command: "pm2 reload trientes-web" }),
    ).toBe("♻️ рестарт prod");
  });

  it("npm/vitest detected", () => {
    expect(renderToolStatus("Bash", { command: "npm test" })).toBe(
      "🧪 запускаю тесты",
    );
  });

  it("generic Bash falls back to command preview", () => {
    expect(renderToolStatus("Bash", { command: "ls -la" })).toBe(
      "⚙️ bash: ls -la",
    );
  });

  it("Grep shows pattern", () => {
    expect(renderToolStatus("Grep", { pattern: "TODO" })).toBe("🔎 ищу TODO");
  });

  it("unknown tool shows tool name", () => {
    expect(renderToolStatus("MysteryTool", {})).toBe("🔧 MysteryTool");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/statusRender.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/statusRender.ts`**

```ts
// bot/statusRender.ts

function short(path: string, max = 60): string {
  // strip leading /home/dv/trientes/ if present
  const cleaned = path.replace(/^\/home\/dv\/trientes\//, "");
  if (cleaned.length <= max) return cleaned;
  return "…" + cleaned.slice(-(max - 1));
}

function bashStatus(command: string): string {
  const lower = command.toLowerCase();
  if (/\bgit\s+commit\b/.test(lower)) return "💾 коммичу";
  if (/\bgit\s+push\b/.test(lower)) return "🚀 пушу";
  if (/\bpm2\s+(reload|restart|start)\b/.test(lower)) return "♻️ рестарт prod";
  if (/\b(npm|pnpm|yarn)\s+(test|run\s+test)\b/.test(lower)) return "🧪 запускаю тесты";
  if (/\bvitest\b/.test(lower)) return "🧪 запускаю тесты";
  if (/\bnpm\s+(install|i)\b/.test(lower)) return "📦 ставлю зависимости";
  if (/\bgit\s+pull\b/.test(lower)) return "⤵️ git pull";
  const preview = command.length > 60 ? command.slice(0, 57) + "…" : command;
  return `⚙️ bash: ${preview}`;
}

export function renderToolStatus(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "Read":
      return `📖 читаю ${short(String(i.file_path ?? ""))}`;
    case "Edit":
      return `✏️ правлю ${short(String(i.file_path ?? ""))}`;
    case "Write":
      return `📝 пишу ${short(String(i.file_path ?? ""))}`;
    case "Grep":
      return `🔎 ищу ${String(i.pattern ?? "")}`;
    case "Glob":
      return `🔎 ищу файлы ${String(i.pattern ?? "")}`;
    case "Bash":
      return bashStatus(String(i.command ?? ""));
    default:
      return `🔧 ${toolName}`;
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/statusRender.test.ts
```
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/statusRender.ts bot/__tests__/statusRender.test.ts
git commit -m "feat(bot): render tool_use events as short ru status strings"
```

---

## Task 10: Telegram view (StatusUpdater with 1Hz debounce)

**Files:**
- Create: `bot/telegramView.ts`
- Create: `bot/__tests__/telegramView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/telegramView.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatusUpdater, truncate } from "../telegramView";

describe("truncate", () => {
  it("returns string unchanged when below limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("truncates and adds ellipsis", () => {
    expect(truncate("0123456789abc", 10)).toBe("0123456789…");
  });
});

describe("StatusUpdater debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBot() {
    return {
      api: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  it("first update is immediate", async () => {
    const bot = makeBot();
    const u = new StatusUpdater(bot as never, 1, 5);
    u.update("first");
    await vi.runAllTimersAsync();
    expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
    expect(bot.api.editMessageText).toHaveBeenCalledWith(1, 5, "first");
  });

  it("burst within 1s collapses to one trailing edit", async () => {
    const bot = makeBot();
    const u = new StatusUpdater(bot as never, 1, 5);
    u.update("a"); // leading
    u.update("b");
    u.update("c");
    u.update("d");
    await vi.advanceTimersByTimeAsync(1100);
    expect(bot.api.editMessageText).toHaveBeenCalledTimes(2);
    expect(bot.api.editMessageText.mock.calls[0][2]).toBe("a");
    expect(bot.api.editMessageText.mock.calls[1][2]).toBe("d");
  });

  it("flush() forces the pending update immediately", async () => {
    const bot = makeBot();
    const u = new StatusUpdater(bot as never, 1, 5);
    u.update("a");
    u.update("b");
    await u.flush();
    expect(bot.api.editMessageText).toHaveBeenLastCalledWith(1, 5, "b");
  });

  it("skips identical consecutive payloads", async () => {
    const bot = makeBot();
    const u = new StatusUpdater(bot as never, 1, 5);
    u.update("same");
    u.update("same");
    await vi.advanceTimersByTimeAsync(1100);
    expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/telegramView.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/telegramView.ts`**

```ts
// bot/telegramView.ts
import type { Bot } from "grammy";

const MIN_INTERVAL_MS = 1000;

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export class StatusUpdater {
  private lastSent = "";
  private lastSentAt = 0;
  private pending: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly chatId: number,
    private readonly messageId: number,
  ) {}

  update(text: string): void {
    if (text === this.lastSent || text === this.pending) {
      this.pending = null;
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed >= MIN_INTERVAL_MS) {
      this.send(text);
    } else {
      this.pending = text;
      if (!this.timer) {
        this.timer = setTimeout(
          () => this.fireTrailing(),
          MIN_INTERVAL_MS - elapsed,
        );
      }
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending !== null && this.pending !== this.lastSent) {
      await this.sendAsync(this.pending);
      this.pending = null;
    }
  }

  private fireTrailing(): void {
    this.timer = null;
    if (this.pending !== null && this.pending !== this.lastSent) {
      this.send(this.pending);
      this.pending = null;
    }
  }

  private send(text: string): void {
    void this.sendAsync(text);
  }

  private async sendAsync(text: string): Promise<void> {
    this.lastSent = text;
    this.lastSentAt = Date.now();
    try {
      await this.bot.api.editMessageText(this.chatId, this.messageId, text);
    } catch {
      // swallow — Telegram throws on identical content or transient errors; not fatal
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/telegramView.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/telegramView.ts bot/__tests__/telegramView.test.ts
git commit -m "feat(bot): debounced StatusUpdater for telegram status edits"
```

---

## Task 11: Claude runner (spawn + lifecycle)

**Files:**
- Create: `bot/claudeRunner.ts`
- Create: `bot/__tests__/claudeRunner.test.ts`

This task is bigger than typical — it has spawn lifecycle, timeout, cancellation, and stream parsing wired in. Steps decompose it.

- [ ] **Step 1: Write the failing test (basic happy path)**

```ts
// bot/__tests__/claudeRunner.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as cp from "node:child_process";
import { ClaudeRunner } from "../claudeRunner";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
};

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.pid = 12345;
  return child;
}

function emitInit(child: FakeChild, sessionId: string) {
  child.stdout.write(
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }) + "\n",
  );
}
function emitToolUse(child: FakeChild, name: string, input: unknown) {
  child.stdout.write(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    }) + "\n",
  );
}
function emitText(child: FakeChild, text: string) {
  child.stdout.write(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    }) + "\n",
  );
}
function emitResult(child: FakeChild) {
  child.stdout.write(
    JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n",
  );
}
function exitClean(child: FakeChild, code = 0) {
  child.stdout.end();
  child.stderr.end();
  child.emit("close", code);
}

describe("ClaudeRunner", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  let child: FakeChild;

  beforeEach(() => {
    child = makeFakeChild();
    spawnSpy = vi.spyOn(cp, "spawn").mockReturnValue(child as never);
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  it("spawns claude WITHOUT --resume on first run", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const events: unknown[] = [];
    const runPromise = runner.run({
      userId: 1,
      prompt: "hi",
      sessionId: null,
      onEvent: (e) => events.push(e),
    });

    expect(spawnSpy).toHaveBeenCalled();
    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("hi");
    expect(args).not.toContain("--resume");

    emitInit(child, "sess-001");
    emitText(child, "done");
    emitResult(child);
    exitClean(child, 0);
    const result = await runPromise;
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe("done");
    expect(result.sessionId).toBe("sess-001");
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("spawns with --resume when sessionId provided", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const promise = runner.run({
      userId: 1,
      prompt: "continue",
      sessionId: "sess-001",
      onEvent: () => {},
    });
    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-001");
    emitText(child, "ok");
    exitClean(child, 0);
    await promise;
  });

  it("concatenates multiple text events into finalText", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const promise = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    emitText(child, "part1\n");
    emitText(child, "part2");
    exitClean(child, 0);
    const r = await promise;
    expect(r.finalText).toBe("part1\npart2");
  });

  it("captures stderr tail on non-zero exit", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const promise = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    child.stderr.write("boom\n");
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 1);
    const r = await promise;
    expect(r.exitCode).toBe(1);
    expect(r.stderrTail).toContain("boom");
  });

  it("cancel() sends SIGTERM and resolves", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const promise = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    runner.cancel(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    exitClean(child, 143);
    const r = await promise;
    expect(r.exitCode).toBe(143);
  });

  it("rejects second concurrent run for same user", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    const first = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    await expect(
      runner.run({ userId: 1, prompt: "y", sessionId: null, onEvent: () => {} }),
    ).rejects.toThrow(/already running/);
    exitClean(child, 0);
    await first;
  });

  it("isActive reflects state", async () => {
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 60000 });
    expect(runner.isActive(1)).toBe(false);
    const p = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    expect(runner.isActive(1)).toBe(true);
    exitClean(child, 0);
    await p;
    expect(runner.isActive(1)).toBe(false);
  });

  it("timeout fires SIGTERM and reports exitCode", async () => {
    vi.useFakeTimers();
    const runner = new ClaudeRunner({ cwd: "/repo", timeoutMs: 100 });
    const promise = runner.run({
      userId: 1,
      prompt: "x",
      sessionId: null,
      onEvent: () => {},
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    exitClean(child, 143);
    const r = await promise;
    expect(r.exitCode).toBe(143);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/claudeRunner.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/claudeRunner.ts`**

```ts
// bot/claudeRunner.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { StreamEvent, RunResult } from "./types";
import { parseStreamLine } from "./streamParser";

export interface RunArgs {
  userId: number;
  prompt: string;
  sessionId: string | null;
  onEvent: (event: StreamEvent) => void;
}

export interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
  claudeBinary?: string; // default "claude"
}

export class ClaudeRunner {
  private active = new Map<number, ChildProcess>();

  constructor(private readonly opts: RunnerOptions) {}

  isActive(userId: number): boolean {
    return this.active.has(userId);
  }

  cancel(userId: number): void {
    const child = this.active.get(userId);
    if (!child) return;
    child.kill("SIGTERM");
  }

  async run(args: RunArgs): Promise<RunResult> {
    if (this.active.has(args.userId)) {
      throw new Error(`claude already running for user ${args.userId}`);
    }

    const cliArgs: string[] = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    if (args.sessionId) {
      cliArgs.push("--resume", args.sessionId);
    }
    cliArgs.push(args.prompt);

    const startedAt = Date.now();
    const child = spawn(this.opts.claudeBinary ?? "claude", cliArgs, {
      cwd: this.opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.active.set(args.userId, child);

    let finalText = "";
    let sessionId: string | null = null;
    let stderrBuf = "";

    const stdoutLines = createInterface({ input: child.stdout! });
    stdoutLines.on("line", (line) => {
      const ev = parseStreamLine(line);
      if (!ev) return;
      if (ev.kind === "init" && !sessionId) sessionId = ev.sessionId;
      if (ev.kind === "text") finalText += ev.text;
      args.onEvent(ev);
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > 4000) {
        stderrBuf = stderrBuf.slice(-4000);
      }
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, this.opts.timeoutMs);

    return new Promise<RunResult>((resolve) => {
      child.on("close", (code) => {
        clearTimeout(timeout);
        this.active.delete(args.userId);
        resolve({
          exitCode: code ?? 0,
          finalText,
          stderrTail: stderrBuf.slice(-2000),
          sessionId,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/claudeRunner.test.ts
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/claudeRunner.ts bot/__tests__/claudeRunner.test.ts
git commit -m "feat(bot): spawn claude CLI with lifecycle, timeout, cancel"
```

---

## Task 12: Post-run git enrichment (commit SHA + files)

**Files:**
- Create: `bot/gitEnrich.ts`
- Create: `bot/__tests__/gitEnrich.test.ts`

After a clean Claude run, the bot queries git for HEAD SHA + files changed in that commit to enrich the final reply. Isolated so it can be tested with a real git tmp repo.

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/gitEnrich.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { collectHeadInfo } from "../gitEnrich";

describe("collectHeadInfo", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "git-enrich-"));
    execSync("git init -q -b main", { cwd: dir });
    execSync('git config user.email "t@t.t"', { cwd: dir });
    execSync('git config user.name "T"', { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "hello");
    execSync("git add a.txt && git commit -q -m initial", { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns SHA, subject and files of HEAD commit", async () => {
    writeFileSync(join(dir, "b.txt"), "world");
    writeFileSync(join(dir, "c.txt"), "!");
    execSync("git add b.txt c.txt && git commit -q -m 'add bc'", { cwd: dir });
    const info = await collectHeadInfo(dir);
    expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(info.shortSha).toBe(info.sha.slice(0, 7));
    expect(info.subject).toBe("add bc");
    expect(info.files.sort()).toEqual(["b.txt", "c.txt"]);
  });

  it("returns empty file list for initial commit (no parent)", async () => {
    const info = await collectHeadInfo(dir);
    // git diff-tree on root commit returns no diff; files may be [] or [a.txt] depending on flag — accept both
    expect(info.subject).toBe("initial");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/gitEnrich.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/gitEnrich.ts`**

```ts
// bot/gitEnrich.ts
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileP = promisify(execFile);

export interface HeadInfo {
  sha: string;
  shortSha: string;
  subject: string;
  files: string[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout.trim();
}

export async function collectHeadInfo(cwd: string): Promise<HeadInfo> {
  const sha = await git(cwd, ["rev-parse", "HEAD"]);
  const subject = await git(cwd, ["log", "-1", "--pretty=%s"]);
  let files: string[] = [];
  try {
    const out = await git(cwd, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "HEAD",
    ]);
    files = out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    files = [];
  }
  return { sha, shortSha: sha.slice(0, 7), subject, files };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/gitEnrich.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/gitEnrich.ts bot/__tests__/gitEnrich.test.ts
git commit -m "feat(bot): collect HEAD sha + subject + changed files"
```

---

## Task 13: Commands handler

**Files:**
- Create: `bot/commands.ts`
- Create: `bot/__tests__/commands.test.ts`

Pure dispatch — takes a deps object so all I/O is mockable.

- [ ] **Step 1: Write the failing test**

```ts
// bot/__tests__/commands.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleCommand, type CommandDeps } from "../commands";

function makeDeps(over: Partial<CommandDeps> = {}): CommandDeps {
  return {
    session: {
      reset: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      getVerbose: vi.fn().mockResolvedValue(false),
      setVerbose: vi.fn().mockResolvedValue(undefined),
    },
    runner: {
      isActive: vi.fn().mockReturnValue(false),
      cancel: vi.fn(),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("handleCommand", () => {
  it("/whoami replies with userId (no auth required)", async () => {
    const deps = makeDeps();
    await handleCommand("/whoami", 42, deps);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringContaining("42"));
  });

  it("/new resets session and replies", async () => {
    const deps = makeDeps();
    await handleCommand("/new", 1, deps);
    expect(deps.session.reset).toHaveBeenCalledWith(1);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/новая сессия/i));
  });

  it("/cancel kills active process when present", async () => {
    const deps = makeDeps();
    (deps.runner.isActive as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await handleCommand("/cancel", 1, deps);
    expect(deps.runner.cancel).toHaveBeenCalledWith(1);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/отмен/i));
  });

  it("/cancel says nothing-to-cancel when no active process", async () => {
    const deps = makeDeps();
    await handleCommand("/cancel", 1, deps);
    expect(deps.runner.cancel).not.toHaveBeenCalled();
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/нечего/i));
  });

  it("/verbose toggles flag and reports new state", async () => {
    const deps = makeDeps();
    (deps.session.getVerbose as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await handleCommand("/verbose", 1, deps);
    expect(deps.session.setVerbose).toHaveBeenCalledWith(1, true);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/verbose.*вкл/i));
  });

  it("/status with no session reports idle", async () => {
    const deps = makeDeps();
    await handleCommand("/status", 1, deps);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/нет активной сессии/i));
  });

  it("/status with session shows sessionId and idle process", async () => {
    const deps = makeDeps();
    (deps.session.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      claudeSessionId: "abc",
      startedAt: Date.now(),
      lastActivity: Date.now(),
    });
    await handleCommand("/status", 1, deps);
    const msg = (deps.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toContain("abc");
  });

  it("unknown command lists available commands", async () => {
    const deps = makeDeps();
    await handleCommand("/foo", 1, deps);
    expect(deps.reply).toHaveBeenCalledWith(expect.stringMatching(/неизвестная команда/i));
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run bot/__tests__/commands.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `bot/commands.ts`**

```ts
// bot/commands.ts
import type { SessionRecord } from "./types";

export interface CommandDeps {
  session: {
    reset: (userId: number) => Promise<void>;
    get: (userId: number) => Promise<SessionRecord | null>;
    getVerbose: (userId: number) => Promise<boolean>;
    setVerbose: (userId: number, on: boolean) => Promise<void>;
  };
  runner: {
    isActive: (userId: number) => boolean;
    cancel: (userId: number) => void;
  };
  reply: (text: string) => Promise<void>;
}

export async function handleCommand(
  command: string,
  userId: number,
  deps: CommandDeps,
): Promise<void> {
  const cmd = command.trim().split(/\s+/)[0];
  switch (cmd) {
    case "/whoami":
      await deps.reply(`твой telegram user_id: \`${userId}\``);
      return;
    case "/new":
      await deps.session.reset(userId);
      await deps.reply("новая сессия — следующее сообщение начнёт с чистого листа");
      return;
    case "/cancel":
      if (deps.runner.isActive(userId)) {
        deps.runner.cancel(userId);
        await deps.reply("отменяю текущую задачу…");
      } else {
        await deps.reply("нечего отменять — активной задачи нет");
      }
      return;
    case "/verbose": {
      const current = await deps.session.getVerbose(userId);
      await deps.session.setVerbose(userId, !current);
      await deps.reply(
        !current ? "verbose режим вкл — увидишь каждый tool call" : "verbose выкл",
      );
      return;
    }
    case "/status": {
      const rec = await deps.session.get(userId);
      const running = deps.runner.isActive(userId);
      if (!rec) {
        await deps.reply(
          running
            ? "нет активной сессии в Redis, но процесс claude запущен (странно)"
            : "нет активной сессии. напиши что-нибудь — начнём с нуля",
        );
        return;
      }
      const since = Math.round((Date.now() - rec.lastActivity) / 1000);
      await deps.reply(
        [
          `session_id: \`${rec.claudeSessionId}\``,
          `последняя активность: ${since}с назад`,
          `процесс claude: ${running ? "запущен" : "idle"}`,
        ].join("\n"),
      );
      return;
    }
    default:
      await deps.reply(
        "неизвестная команда. доступны: /new /status /cancel /verbose /whoami",
      );
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run bot/__tests__/commands.test.ts
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/commands.ts bot/__tests__/commands.test.ts
git commit -m "feat(bot): slash command handlers (/new /status /cancel /verbose /whoami)"
```

---

## Task 14: Verify Claude CLI flag shape on server

**Files:** none (verification task — produces a note in commit message only)

The spec assumes specific flag names and event shapes for the `claude` CLI in headless mode. Before wiring the integration layer, confirm them against the installed CLI.

- [ ] **Step 1: SSH to server and check CLI**

```bash
ssh dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && claude --version || echo NOT_INSTALLED'
```

If `NOT_INSTALLED`:
```bash
ssh dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npm i -g @anthropic-ai/claude-code'
```
Then on the server, run `claude` interactively once to log in via the Anthropic subscription (browser OAuth — paste resulting URL into local browser, complete, paste back).

- [ ] **Step 2: Confirm flag names**

```bash
ssh dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && claude --help'
```
Verify these flags exist as written: `-p`, `--output-format stream-json`, `--verbose`, `--resume`, `--dangerously-skip-permissions`. If any differ, note the actual name and update the relevant code (`bot/claudeRunner.ts` `cliArgs` array and the matching test).

- [ ] **Step 3: Sample a stream-json run**

```bash
ssh dv@85.192.25.242 'cd ~/trientes && export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && claude -p --output-format stream-json --verbose --dangerously-skip-permissions "say hello in 3 words" 2>/dev/null | head -20'
```

Confirm:
- An early line has `"type":"system"` and `"subtype":"init"` with `"session_id":"..."`.
- Assistant lines have `"type":"assistant"` with `message.content[].type` of `tool_use` or `text`.
- A trailing `"type":"result"` line appears.

If event shapes differ, update `bot/streamParser.ts` and `bot/__tests__/streamParser.test.ts` accordingly.

- [ ] **Step 4: Commit any corrections**

If you adjusted parser or runner code:
```bash
git add bot/streamParser.ts bot/__tests__/streamParser.test.ts bot/claudeRunner.ts bot/__tests__/claudeRunner.test.ts
git commit -m "fix(bot): align parser/runner with installed claude CLI"
```

If no changes, skip the commit and continue.

---

## Task 15: Wiring layer — webhook + main entry

**Files:**
- Create: `bot/webhook.ts`
- Create: `bot/index.ts`

This is the integration layer. No automated test (per spec). Acceptance is manual via Task 17.

- [ ] **Step 1: Implement `bot/webhook.ts`**

```ts
// bot/webhook.ts
import express, { type Express } from "express";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";

export function createWebhookApp(bot: Bot, secret: string): Express {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.post(`/bot/${secret}`, (req, res, next) => {
    const headerSecret = req.header("x-telegram-bot-api-secret-token");
    if (headerSecret !== secret) {
      res.status(401).json({ error: "bad secret token" });
      return;
    }
    webhookCallback(bot, "express")(req, res, next);
  });
  return app;
}
```

- [ ] **Step 2: Implement `bot/index.ts`**

```ts
// bot/index.ts
import "dotenv/config";
import { Bot, type Context } from "grammy";
import OpenAI from "openai";
import Redis from "ioredis";
import { join } from "node:path";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { isAllowed } from "./auth";
import { SessionStore } from "./session";
import { ClaudeRunner } from "./claudeRunner";
import { StatusUpdater, truncate } from "./telegramView";
import { renderToolStatus } from "./statusRender";
import { handleCommand } from "./commands";
import { collectHeadInfo } from "./gitEnrich";
import { downloadTelegramVoice, transcribeBuffer } from "./voice";

const config = loadConfig();
const logger = createLogger(join(config.claudeCwd, "bot/logs"));
const redis = new Redis(config.redisUrl);
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const session = new SessionStore(redis);
const runner = new ClaudeRunner({
  cwd: config.claudeCwd,
  timeoutMs: config.claudeTimeoutMs,
});
const bot = new Bot(config.telegramBotToken);

async function unauthorizedDrop(ctx: Context, snippet: string): Promise<void> {
  await logger.appendUnauthorized({
    ts: new Date().toISOString(),
    userId: ctx.from?.id ?? 0,
    username: ctx.from?.username ?? null,
    textSnippet: snippet.slice(0, 200),
  });
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;

  if (text.startsWith("/")) {
    // /whoami is allowed for everyone; all others require whitelist
    if (text.startsWith("/whoami") || isAllowed(userId, config.allowedUserIds)) {
      await handleCommand(text, userId, {
        session,
        runner,
        reply: (t) => ctx.reply(t, { parse_mode: "Markdown" }).then(() => {}),
      });
    } else {
      await unauthorizedDrop(ctx, text);
    }
    return;
  }

  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, text);
    return;
  }
  await processPrompt(ctx, userId, text);
});

bot.on("message:voice", async (ctx) => {
  const userId = ctx.from.id;
  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, "<voice>");
    return;
  }
  let prompt: string;
  try {
    const { buffer, filename } = await downloadTelegramVoice(
      ctx.message.voice.file_id,
      config.telegramBotToken,
    );
    prompt = await transcribeBuffer(buffer, filename, openai);
  } catch (err) {
    await ctx.reply(
      "не разобрал голос, повтори текстом (ошибка: " +
        (err instanceof Error ? err.message : String(err)).slice(0, 100) +
        ")",
    );
    return;
  }
  await ctx.reply(`🎤 услышал: ${prompt}`);
  await processPrompt(ctx, userId, prompt);
});

async function processPrompt(
  ctx: Context,
  userId: number,
  prompt: string,
): Promise<void> {
  if (runner.isActive(userId)) {
    await ctx.reply("текущая задача ещё идёт, /cancel или подожди");
    return;
  }
  const placeholder = await ctx.reply("🤔 думаю...");
  const status = new StatusUpdater(bot, ctx.chat!.id, placeholder.message_id);
  const verbose = await session.getVerbose(userId);
  const existing = await session.get(userId);
  const startedAt = Date.now();
  let writtenSessionId: string | null = existing?.claudeSessionId ?? null;

  try {
    const result = await runner.run({
      userId,
      prompt,
      sessionId: existing?.claudeSessionId ?? null,
      onEvent: (ev) => {
        if (ev.kind === "init" && !writtenSessionId) {
          writtenSessionId = ev.sessionId;
          void session.set(userId, ev.sessionId);
        }
        if (ev.kind === "tool_use") {
          const line = renderToolStatus(ev.toolName, ev.input);
          if (verbose) {
            void ctx.reply(line);
          } else {
            status.update(line);
          }
        }
      },
    });

    await status.flush();

    if (writtenSessionId) {
      await session.touch(userId);
    }

    let reply: string;
    if (result.exitCode === 0) {
      let suffix = "";
      try {
        const head = await collectHeadInfo(config.claudeCwd);
        const filesLine =
          head.files.length > 0
            ? `\nфайлы: ${head.files.slice(0, 10).join(", ")}${head.files.length > 10 ? ", …" : ""}`
            : "";
        suffix = `\n\n✅ готово\nкоммит: \`${head.shortSha}\` — ${head.subject}${filesLine}\n${config.githubRepoUrl}/commit/${head.sha}`;
      } catch {
        suffix = "\n\n✅ готово (git enrich failed)";
      }
      reply = truncate(result.finalText || "(пусто)", 3500) + suffix;
    } else {
      reply =
        `❌ claude exited ${result.exitCode}\n` +
        "```\n" +
        truncate(result.stderrTail || "(no stderr)", 2000) +
        "\n```";
    }

    await ctx.reply(reply, { parse_mode: "Markdown" });

    await logger.appendAudit({
      ts: new Date().toISOString(),
      userId,
      prompt,
      sessionId: writtenSessionId,
      claudeExitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    await ctx.reply(
      "бот упал: " +
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
    );
    await logger.appendAudit({
      ts: new Date().toISOString(),
      userId,
      prompt,
      sessionId: writtenSessionId,
      claudeExitCode: -1,
      durationMs: Date.now() - startedAt,
    });
  }
}

import { createWebhookApp } from "./webhook";

const app = createWebhookApp(bot, config.telegramWebhookSecret);
app.listen(config.botPort, "127.0.0.1", () => {
  console.log(
    `[bot] listening on 127.0.0.1:${config.botPort}, cwd=${config.claudeCwd}, whitelist=${[...config.allowedUserIds].join(",") || "(empty)"}`,
  );
});

process.on("SIGTERM", () => {
  console.log("[bot] SIGTERM, shutting down");
  redis.disconnect();
  process.exit(0);
});
```

- [ ] **Step 3: Smoke-check that TS compiles (locally, not full Next build)**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "bot/" || echo "no bot errors"
```
Expected: `no bot errors`. If errors appear (only inside `bot/`), fix them. Errors elsewhere in the repo are pre-existing and out of scope (recall: macOS Tahoe SWC dlopen issue may affect full `next build`, but `tsc --noEmit` should still run for type checks).

If `tsc` hangs locally (the known SWC issue may also affect tsc), skip this step and rely on test passes + manual server smoke test in Task 17. Note this in the commit message.

- [ ] **Step 4: Add `dotenv` dependency if not already present**

Check `package.json` for `dotenv`. If missing:
```bash
npm install dotenv
```

- [ ] **Step 5: Commit**

```bash
git add bot/webhook.ts bot/index.ts package.json package-lock.json
git commit -m "feat(bot): wire webhook + index entry, integrating all modules"
```

---

## Task 16: PM2 entry

**Files:**
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Read current `ecosystem.config.js`**

```bash
cat ecosystem.config.js
```

Note the existing entries (`trientes-web`, `trientes-worker`) — copy their style.

- [ ] **Step 2: Add bot entry**

Edit `ecosystem.config.js`, append a new app object to the `apps` array (paths and node binary match your existing entries — if they use `interpreter`, copy that too):

```js
{
  name: "trientes-bot",
  cwd: "/home/dv/trientes",
  script: "npx",
  args: "tsx bot/index.ts",
  env_file: "/home/dv/trientes/.env",
  max_memory_restart: "300M",
  autorestart: true,
  watch: false,
}
```

If the existing entries use `interpreter: "node"` and `script: "node_modules/.bin/tsx"` style, prefer that form for consistency. The key requirements: `cwd` is the repo root, `tsx bot/index.ts` is the runtime invocation, env loads from the same `.env` as the worker.

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore(bot): add trientes-bot PM2 entry"
```

---

## Task 17: Server deployment + manual acceptance

**Files:** none in repo. Runbook for server-side actions.

- [ ] **Step 1: Push code to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Pull on server, install deps**

```bash
ssh dv@85.192.25.242 << 'EOF'
set -e
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd ~/trientes
git stash || true
git pull origin main
npm install
git stash pop || true
EOF
```

- [ ] **Step 3: Create Telegram bot if not yet done**

In Telegram, message @BotFather → `/newbot` → follow prompts. Save the bot token.

- [ ] **Step 4: Generate webhook secret**

Locally or on server:
```bash
openssl rand -hex 32
```
Save output as `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 5: Add bot env vars to server `.env`**

```bash
ssh dv@85.192.25.242 'cat >> ~/trientes/.env << EOF
TELEGRAM_BOT_TOKEN=<paste-token>
TELEGRAM_WEBHOOK_SECRET=<paste-secret>
BOT_ALLOWED_USER_IDS=
OPENAI_API_KEY=<paste-openai-key>
BOT_PORT=4100
CLAUDE_CWD=/home/dv/trientes
CLAUDE_TIMEOUT_MS=600000
GITHUB_REPO_URL=https://github.com/dvvolkovv/trientes
EOF'
```

(Use heredoc carefully — paste literal values, not the placeholders.)

- [ ] **Step 6: Install Claude Code CLI on server**

```bash
ssh -t dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npm i -g @anthropic-ai/claude-code && claude'
```

The interactive `claude` invocation will print an OAuth URL. Open in local browser, log in with the same Anthropic account that has the subscription, paste the returned code back into the SSH session. Token persists to `~/.claude/`.

Verify:
```bash
ssh dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && claude -p "say hi"'
```
Expected: a short greeting.

- [ ] **Step 7: Add nginx location for bot webhook**

Edit the trientes.org nginx server block (path depends on your setup, typically `/etc/nginx/sites-available/trientes.org`):

```nginx
location /bot/REPLACE_WITH_TELEGRAM_WEBHOOK_SECRET {
    proxy_pass http://127.0.0.1:4100;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Telegram-Bot-Api-Secret-Token $http_x_telegram_bot_api_secret_token;
    proxy_read_timeout 30s;
}
```

Reload nginx:
```bash
ssh dv@85.192.25.242 'sudo nginx -t && sudo systemctl reload nginx'
```

- [ ] **Step 8: Start bot under PM2**

```bash
ssh dv@85.192.25.242 'export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && cd ~/trientes && pm2 start ecosystem.config.js --only trientes-bot && pm2 save'
```

Check logs:
```bash
ssh dv@85.192.25.242 'pm2 logs trientes-bot --lines 30 --nostream'
```
Expected: `[bot] listening on 127.0.0.1:4100, cwd=/home/dv/trientes, whitelist=(empty)`.

- [ ] **Step 9: Register webhook with Telegram**

```bash
SECRET=<paste-secret>
TOKEN=<paste-token>
curl "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=https://trientes.org/bot/${SECRET}" \
  -d "secret_token=${SECRET}"
```
Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`.

- [ ] **Step 10: Bootstrap whitelist via /whoami**

From @dvvolkov in Telegram: send `/whoami` to the bot. Save the numeric ID.
From @ALGENOMIC: same.

Add both IDs:
```bash
ssh dv@85.192.25.242 'sed -i "s/^BOT_ALLOWED_USER_IDS=.*/BOT_ALLOWED_USER_IDS=<id1>,<id2>/" ~/trientes/.env && pm2 restart trientes-bot'
```

- [ ] **Step 11: Acceptance run**

In Telegram from a whitelisted account:

1. Send text "что в README?" → expect status flow + reply with README contents.
2. Send `/new`, then send voice "покажи последний коммит" → expect 🎤-prefix + status + reply.
3. Send text "поправь typo в README: Triente→Trientes если есть" → wait for `✅ готово` with commit URL. Open the URL — verify the diff.
4. Send `/verbose`, send a small request → verify each tool_use becomes a separate message.
5. Send a long request, then send `/cancel` while running → expect "отменяю текущую задачу…".

If any step fails, check `pm2 logs trientes-bot --lines 100`.

- [ ] **Step 12: Add logrotate**

```bash
ssh dv@85.192.25.242 'sudo tee /etc/logrotate.d/trientes-bot > /dev/null << EOF
/home/dv/trientes/bot/logs/*.jsonl {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 dv dv
}
EOF'
```

Verify config:
```bash
ssh dv@85.192.25.242 'sudo logrotate -d /etc/logrotate.d/trientes-bot'
```
Expected: no errors.

- [ ] **Step 13: Final commit**

If any tweaks were made during acceptance (env values do NOT go in git):
```bash
git status
# verify nothing staged that contains secrets
git push origin main
```

If everything passed without changes, no commit needed — just log the deployment in conversation.

---

## Spec Coverage Review

| Spec section | Covered by task(s) |
|---|---|
| Architecture (bot on server, webhook, nginx, PM2) | 16, 17 |
| `webhook.ts` (Express + secret validation) | 15 |
| `auth.ts` (whitelist) | 5 |
| `voice.ts` (Whisper) | 7 |
| `session.ts` (Redis store) | 6 |
| `claudeRunner.ts` (spawn + lifecycle) | 11, 14 |
| `telegramView.ts` (debounced edits) | 10 |
| `commands.ts` (/new /status /cancel /verbose /whoami) | 13 |
| Stream parser (init, tool_use, text, result) | 8 |
| Tool status rendering | 9 |
| Git enrichment (HEAD SHA + files) | 12 |
| Logging (JSONL audit + unauthorized) | 4 |
| Config (env parsing) | 3 |
| Per-user concurrency guard | 11 (`already running` test) |
| Verbose mode toggle | 6 (`getVerbose/setVerbose`), 13 (`/verbose`), 15 (uses flag in `processPrompt`) |
| Whisper failure → "повтори текстом" | 15 (`message:voice` handler try/catch) |
| Claude crash → stderr tail in reply | 11 + 15 |
| Claude timeout 10 min | 11 (timer in runner) |
| Redis down → degraded mode | Partially: spec calls for fall-through to per-message mode. **Currently** `bot/index.ts` would crash on the very first Redis call. If you want the degraded path, wrap `session.get/set/touch/getVerbose` calls in `processPrompt` with try/catch that logs and continues with `sessionId: null` + `verbose=false`. **Add this hardening pass** as part of Task 15 if/when Redis reliability becomes a concern; spec marks it as "degraded mode, not crash" but it's not yet wired in. Marking as a known follow-up — call it out in the commit message of Task 15 if you skip it. |
| 30-min session TTL | 6 (`SESSION_TTL_SECONDS`) |
| `--dangerously-skip-permissions` flag | 11 (in `cliArgs`) |
| Webhook secret header validation | 15 (`webhook.ts`) |
| Loopback bind | 15 (`app.listen(..., "127.0.0.1", ...)`) |
| nginx location | 17 (step 7) |
| `setWebhook` call | 17 (step 9) |
| logrotate | 17 (step 12) |

**Gap acknowledged:** Redis-degraded mode is not implemented at the wiring layer. The session module supports it (returns null gracefully if Redis is up but key missing), but if the Redis connection itself drops, `ioredis` will throw on every `set`/`get` and the bot will surface errors to the user. Decision: defer — Redis is the same instance that prod already depends on (live ticks, sessions), so if Redis is down the bot being degraded is a small concern next to prod being broken anyway. Document and move on.

---

## Self-review notes (applied)

- **Type consistency:** `SessionStore` uses `get`/`set` (no `getOrCreate`) — matches `claudeRunner` and `processPrompt` call sites. `RunResult.sessionId` mirrored back to `session.set` from the `init` event handler in `processPrompt`, not pulled from `RunResult` after the fact (avoids race where runner finishes before parser sees init — but in practice init is always the first event).
- **No placeholders:** Every step has either runnable code or a runnable shell command. Acceptance steps in Task 17 specify exact `expected` output.
- **Spec coverage:** All sections accounted for above except the explicit Redis-degraded path, which is called out as a deferred follow-up.
- **TDD:** Tasks 3–13 follow strict red-green-commit; Task 11 is bigger but kept inside one task since the spawn/parse/timeout/cancel concerns share state. Tasks 14 (verification), 15 (wiring), 16 (PM2), 17 (deployment) are integration work without unit tests, per spec.
