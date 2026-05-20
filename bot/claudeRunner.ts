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
