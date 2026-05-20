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
