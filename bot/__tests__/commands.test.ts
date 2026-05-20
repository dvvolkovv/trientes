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
