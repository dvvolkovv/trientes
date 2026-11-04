import { redis } from "@/lib/redis";

const CACHE_DEADLINE_MS = 250;

async function withDeadline<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cache_deadline")), CACHE_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await withDeadline(async () => {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      const value = await redis.get(key);
      return value === null ? null : JSON.parse(value) as T;
    });
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await withDeadline(async () => {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      await redis.set(key, JSON.stringify(value), "EX", ttl);
    });
  } catch {
    // Cache is an optimisation; upstream data remains available without Redis.
  }
}
