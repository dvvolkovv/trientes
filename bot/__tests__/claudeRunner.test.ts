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
    expect(result.timedOut).toBe(false);
    expect(result.canceled).toBe(false);
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
    expect(r.canceled).toBe(true);
    expect(r.timedOut).toBe(false);
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
    expect(r.timedOut).toBe(true);
    expect(r.canceled).toBe(false);
    vi.useRealTimers();
  });
});
