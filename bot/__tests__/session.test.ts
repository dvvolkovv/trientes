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
