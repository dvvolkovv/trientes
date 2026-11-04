import { redis } from "@/lib/redis";

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const value = await redis.get(key);
    return value === null ? null : JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Cache is an optimisation; upstream data remains available without Redis.
  }
}
