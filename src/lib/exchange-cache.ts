import Redis from "ioredis";

const CACHE_DEADLINE_MS = 250;
const CIRCUIT_OPEN_MS = 5_000;

let cacheClient: Redis | undefined;
let connecting: { client: Redis; promise: Promise<void> } | undefined;
let circuitOpenUntil = 0;

function getCacheClient(): Redis {
  cacheClient ??= new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: CACHE_DEADLINE_MS,
    connectTimeout: CACHE_DEADLINE_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  return cacheClient;
}

function openCircuit(failed: Redis): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  if (connecting?.client === failed) connecting = undefined;
  if (cacheClient === failed) cacheClient = undefined;
  failed.disconnect();
}

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

const isReady = (client: Redis): boolean => client.status === "ready";

async function readyClient(): Promise<Redis> {
  const client = getCacheClient();
  if (isReady(client)) return client;
  if (client.status === "wait" || client.status === "end") {
    if (connecting?.client !== client) {
      connecting = { client, promise: client.connect().then(() => undefined) };
    }
  }
  const pending = connecting;
  if (!pending || pending.client !== client) throw new Error("cache_not_ready");
  try {
    await pending.promise;
  } finally {
    if (connecting === pending) connecting = undefined;
  }
  if (!isReady(client)) throw new Error("cache_not_ready");
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (Date.now() < circuitOpenUntil) return null;
  const client = getCacheClient();
  let value: string | null;
  try {
    value = await withDeadline(async () => {
      const ready = await readyClient();
      return ready.get(key);
    });
  } catch {
    openCircuit(client);
    return null;
  }
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    // A bad cache value is a miss, not a Redis transport failure.
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  if (Date.now() < circuitOpenUntil) return;
  const client = getCacheClient();
  try {
    await withDeadline(async () => {
      const ready = await readyClient();
      await ready.set(key, JSON.stringify(value), "EX", ttl);
    });
  } catch {
    openCircuit(client);
    // Cache is an optimisation; upstream data remains available without Redis.
  }
}
