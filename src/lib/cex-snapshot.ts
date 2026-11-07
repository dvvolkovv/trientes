/**
 * Загрузка снимков тикеров бирж. Один запрос на биржу за прогон — и снимок
 * живёт в Redis пять минут, чтобы ручная кнопка в кабинете не превращалась в
 * бесплатный прокси к восьми биржам.
 *
 * Сбой одной биржи не ломает прогон: она возвращает код ошибки, а индекс
 * считается по тем, кто ответил.
 */

import { CEX, getConnector, snapshotUrl, type CexConnector, type Ticker, type TickerMap } from "@/lib/cex-registry";

export type SnapshotFetch = (
  input: string,
  init?: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type SnapshotErrorCode = "exchange_unreachable" | "exchange_error";

export type ExchangeSnapshot =
  | { id: string; tickers: TickerMap; fetchedAt: string }
  | { id: string; error: SnapshotErrorCode };

export type SnapshotMap = Map<string, ExchangeSnapshot>;

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

const CACHE_TTL_S = 300;
const TIMEOUT_MS = 8_000;

const cacheKey = (id: string) => `cex:snapshot:${id}`;

type Serialized = { fetchedAt: string; tickers: [string, Ticker][] };

async function fetchOnce(
  connector: CexConnector,
  fetchImpl: SnapshotFetch,
  timeoutMs: number,
): Promise<TickerMap> {
  let res: Awaited<ReturnType<SnapshotFetch>>;
  try {
    res = await fetchImpl(snapshotUrl(connector), {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "trientes-price-index/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SnapshotError("exchange_unreachable", err instanceof Error ? err.message : undefined);
  }
  // 429 и 5xx — это «сейчас не отдаёт», а не «пары нет»: отдельный код, чтобы
  // прежняя цена рынка осталась на месте.
  if (!res.ok) throw new SnapshotError("exchange_unreachable", `http ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SnapshotError("exchange_error", "bad json");
  }
  const tickers = connector.parse(body);
  if (tickers.size === 0) throw new SnapshotError("exchange_error", "empty snapshot");
  return tickers;
}

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  constructor(code: SnapshotErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export async function fetchSnapshot(
  id: string,
  opts: { fetchImpl?: SnapshotFetch; timeoutMs?: number; retries?: number } = {},
): Promise<ExchangeSnapshot> {
  const connector = getConnector(id);
  if (!connector) return { id, error: "exchange_error" };
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as SnapshotFetch);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const retries = opts.retries ?? 1;

  let last: SnapshotError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const tickers = await fetchOnce(connector, fetchImpl, timeoutMs);
      return { id, tickers, fetchedAt: new Date().toISOString() };
    } catch (err) {
      last = err instanceof SnapshotError ? err : new SnapshotError("exchange_error");
      // Повторять смысл есть только при обрыве: битый формат воспроизведётся.
      if (last.code !== "exchange_unreachable") break;
    }
  }
  return { id, error: last?.code ?? "exchange_error" };
}

/**
 * Снимки по списку бирж: сначала Redis, затем сеть. Без Redis (тесты, разовый
 * прогон) работает напрямую.
 */
export async function getSnapshots(
  ids: readonly string[],
  opts: { redis?: RedisLike; fetchImpl?: SnapshotFetch; timeoutMs?: number } = {},
): Promise<SnapshotMap> {
  const out: SnapshotMap = new Map();
  for (const id of new Set(ids)) {
    if (!getConnector(id)) continue;

    if (opts.redis) {
      try {
        const cached = await opts.redis.get(cacheKey(id));
        if (cached) {
          const parsed = JSON.parse(cached) as Serialized;
          out.set(id, { id, tickers: new Map(parsed.tickers), fetchedAt: parsed.fetchedAt });
          continue;
        }
      } catch {
        // Промах кеша и битое значение равнозначны: идём в сеть.
      }
    }

    const snap = await fetchSnapshot(id, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    out.set(id, snap);
    if (opts.redis && "tickers" in snap) {
      const payload: Serialized = { fetchedAt: snap.fetchedAt, tickers: [...snap.tickers] };
      try {
        await opts.redis.set(cacheKey(id), JSON.stringify(payload), "EX", CACHE_TTL_S);
      } catch {
        // Кеш — ускорение, а не условие работы.
      }
    }
  }
  return out;
}

export const ALL_CEX_IDS = CEX.map((c) => c.id);
