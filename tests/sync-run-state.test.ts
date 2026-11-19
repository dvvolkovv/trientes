import { describe, expect, it } from "vitest";
import { RUN_STATE_TTL_SECONDS, readRunState, recordRun, runStateKey, quotaBlocked } from "@/lib/sync/run-state";

/** Redis на словаре: нужны только get/set с TTL. */
const fakeRedis = (seed: Record<string, string> = {}) => {
  const store = new Map(Object.entries(seed));
  const ttls: Record<string, number> = {};
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _mode: "EX", ttl: number) {
      store.set(key, value);
      ttls[key] = ttl;
      return "OK";
    },
  };
};

const NOW = new Date("2026-11-20T06:00:00.000Z");

describe("recordRun / readRunState", () => {
  it("удачный прогон записывает свой час, и он читается обратно", async () => {
    const redis = fakeRedis();
    await recordRun(redis, "coinpaprika", "ok", NOW);
    expect(redis.ttls[runStateKey("coinpaprika")]).toBe(RUN_STATE_TTL_SECONDS);
    expect(await readRunState(redis, "coinpaprika")).toEqual({ okAt: NOW, quotaAt: null });
  });

  it("исчерпанный запас не затирает час последней удачной выборки", async () => {
    const redis = fakeRedis();
    await recordRun(redis, "coinpaprika", "ok", new Date("2026-11-19T10:00:00.000Z"));
    await recordRun(redis, "coinpaprika", "quota", NOW);
    expect(await readRunState(redis, "coinpaprika")).toEqual({
      okAt: new Date("2026-11-19T10:00:00.000Z"),
      quotaAt: NOW,
    });
  });

  it("прогона не было ни разу — null, а не нулевое время", async () => {
    expect(await readRunState(fakeRedis(), "coinpaprika")).toBeNull();
  });

  it("негодная запись читается как её отсутствие, а не роняет отчёт", async () => {
    const redis = fakeRedis({ [runStateKey("coinpaprika")]: "{не json" });
    expect(await readRunState(redis, "coinpaprika")).toBeNull();
  });

  it("сбой Redis прогон не роняет: факт не записан, работа сделана", async () => {
    const broken = {
      async get() {
        throw new Error("redis down");
      },
      async set() {
        throw new Error("redis down");
      },
    };
    await expect(recordRun(broken, "coinpaprika", "ok", NOW)).resolves.toBeUndefined();
    await expect(readRunState(broken, "coinpaprika")).resolves.toBeNull();
  });
});

describe("quotaBlocked", () => {
  const ok = new Date("2026-11-19T10:00:00.000Z");
  const quota = new Date("2026-11-19T22:00:00.000Z");

  it("запас исчерпан, когда последним был отказ по запасу", () => {
    expect(quotaBlocked({ okAt: ok, quotaAt: quota })).toBe(true);
    expect(quotaBlocked({ okAt: null, quotaAt: quota })).toBe(true);
  });

  it("прогон после отказа снял запрет: состояние обычное", () => {
    expect(quotaBlocked({ okAt: quota, quotaAt: ok })).toBe(false);
    expect(quotaBlocked({ okAt: ok, quotaAt: null })).toBe(false);
    expect(quotaBlocked(null)).toBe(false);
  });
});
