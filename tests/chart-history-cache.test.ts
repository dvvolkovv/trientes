import { describe, expect, it, vi } from "vitest";
import { HISTORY_STALE_KEY, HISTORY_STALE_TTL, readChartHistory } from "@/lib/chart-history-cache";
import { HISTORY_KEY } from "@/lib/sync/keys";

type Store = Map<string, string>;

function store(initial: Record<string, unknown> = {}): Store {
  return new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
}

function deps(s: Store, fetchChart: () => Promise<Array<{ time: number; value: number }>>) {
  const writes: Array<{ key: string; ttl: number }> = [];
  return {
    writes,
    io: {
      fetchChart,
      get: async (key: string) => s.get(key) ?? null,
      set: async (key: string, value: string, ttl: number) => {
        s.set(key, value);
        writes.push({ key, ttl });
      },
    },
  };
}

const POINTS = [{ time: 1, value: 10 }];
const OLD = [{ time: 0, value: 9 }];

describe("readChartHistory", () => {
  it("отдаёт свежий кэш, не трогая сеть", async () => {
    const s = store({ [HISTORY_KEY("bitcoin", "7d")]: POINTS });
    const fetchChart = vi.fn();
    const d = deps(s, fetchChart as never);
    await expect(readChartHistory("bitcoin", "7d", d.io)).resolves.toEqual({
      points: POINTS,
      cache: "hit",
    });
    expect(fetchChart).not.toHaveBeenCalled();
  });

  it("на промахе читает сеть и пишет обе копии — свежую и запасную", async () => {
    const s = store();
    const d = deps(s, async () => POINTS);
    await expect(readChartHistory("bitcoin", "7d", d.io)).resolves.toEqual({
      points: POINTS,
      cache: "miss",
    });
    expect(d.writes.map((w) => w.key)).toEqual([
      HISTORY_KEY("bitcoin", "7d"),
      HISTORY_STALE_KEY("bitcoin", "7d"),
    ]);
    expect(d.writes[1].ttl).toBe(HISTORY_STALE_TTL);
  });

  it("сбой сети не ломает график: отдаётся запасная копия", async () => {
    const s = store({ [HISTORY_STALE_KEY("bitcoin", "7d")]: OLD });
    const d = deps(s, async () => {
      throw new Error("coingecko /coins/bitcoin/market_chart 429: limit");
    });
    await expect(readChartHistory("bitcoin", "7d", d.io)).resolves.toEqual({
      points: OLD,
      cache: "stale",
    });
  });

  it("без запасной копии сбой пробрасывается — отдавать нечего", async () => {
    const s = store();
    const d = deps(s, async () => {
      throw new Error("429");
    });
    await expect(readChartHistory("bitcoin", "7d", d.io)).rejects.toThrow("429");
  });

  it("битый кэш не выдаётся за данные", async () => {
    const s = new Map([[HISTORY_KEY("bitcoin", "7d"), "{не json"]]);
    const d = deps(s, async () => POINTS);
    await expect(readChartHistory("bitcoin", "7d", d.io)).resolves.toEqual({
      points: POINTS,
      cache: "miss",
    });
  });

  it("сбой чтения Redis не мешает запросу в сеть", async () => {
    const d = {
      fetchChart: async () => POINTS,
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
    };
    await expect(readChartHistory("bitcoin", "7d", d)).resolves.toEqual({
      points: POINTS,
      cache: "miss",
    });
  });

  it("пустой ответ сети не затирает запасную копию", async () => {
    const s = store({ [HISTORY_STALE_KEY("bitcoin", "7d")]: OLD });
    const d = deps(s, async () => []);
    const out = await readChartHistory("bitcoin", "7d", d.io);
    expect(out.cache).toBe("stale");
    expect(out.points).toEqual(OLD);
    expect(d.writes).toEqual([]);
  });
});
