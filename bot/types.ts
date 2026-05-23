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
  timedOut: boolean; // killed by the watchdog after claudeTimeoutMs
  canceled: boolean; // killed via cancel() (e.g. /cancel)
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
