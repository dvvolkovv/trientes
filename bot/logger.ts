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
