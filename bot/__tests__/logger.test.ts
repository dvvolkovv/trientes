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
