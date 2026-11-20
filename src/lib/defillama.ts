/**
 * DefiLlama — бесплатная опора цены: ключа нет, предела нет, ответ за 0,08 с с
 * нашего адреса (живая проверка 20 ноября). В ответе цена, **тикер** и
 * `confidence` — степень согласия источников службы.
 *
 * Зачем она тут. Посев рынков карточки (слайс X) сверяет найденную на бирже цену
 * с опорной из последнего `CoinSnapshot` — это защита от тикера-двойника. Опоры
 * нет или она старше 48 часов → карточка не сеется (`no_reference`), и так
 * стояли Moonbeam, Moonriver, Secret, AtomOne, Saga и Initia: цену им не писал
 * ни один прогон, потому что в категорию layer-1 CoinGecko они не входят.
 * Уборка AU починила это **ещё одним прогоном к CoinGecko**, то есть доплатила
 * за опору из того же запаса, который нужен главной странице.
 *
 * Здесь опора берётся даром. Живая проверка показала, что все шесть монет у
 * службы есть с `confidence` 0,99 и выше; попутно она отдаёт HDX по 0,00578 $
 * против 338 $ у Gate — то есть охранник тикера-двойника был прав, и спор,
 * который с уборки AV ждал решения владельца, закрывается числом.
 *
 * Своей цены в карточку DefiLlama не пишет и в ценовой индекс не идёт: там один
 * автор — сверка слайса C.
 */

import { countCall } from "./quota/count";
import type { QuotaScope } from "./quota/budget";
import { createRateGate, withRetry, type JsonFetch, type RateGate, type Sleep } from "./rate-gate";

export const DL_BASE = "https://coins.llama.fi";

/** Служба предела не объявляет; промежуток нужен, чтобы развести одновременные. */
export const DL_MIN_INTERVAL_MS = 250;
export const DL_TIMEOUT_MS = 8_000;
export const DL_RETRY_DELAYS_MS = [2_000];

/**
 * Ниже этого согласия источников число опорой не считается. Опора — защита от
 * тикера-двойника, и слабая опора отвергала бы здоровые рынки или пускала чужие.
 */
export const DL_MIN_CONFIDENCE = 0.9;

/** Сколько монет спрашивать одним запросом: адрес службы — список ключей через запятую. */
export const DL_BATCH = 50;

/** Ключ монеты у службы — её id у CoinGecko, с которым мы и так работаем. */
export const llamaKey = (coinId: string) => `coingecko:${coinId}`;

export type LlamaPrice = {
  priceUsd: number;
  symbol: string | null;
  confidence: number | null;
  /** Час самой цены, а не нашего запроса: её возраст принадлежит службе. */
  at: Date | null;
};

export function parseLlamaPrices(raw: unknown): Map<string, LlamaPrice> {
  const out = new Map<string, LlamaPrice>();
  if (!raw || typeof raw !== "object") return out;
  const coins = (raw as { coins?: unknown }).coins;
  if (!coins || typeof coins !== "object") return out;

  for (const [key, value] of Object.entries(coins as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const price = typeof v.price === "number" && Number.isFinite(v.price) && v.price > 0 ? v.price : null;
    if (price === null) continue;
    const seconds = typeof v.timestamp === "number" && Number.isFinite(v.timestamp) ? v.timestamp : null;
    out.set(key.startsWith("coingecko:") ? key.slice("coingecko:".length) : key, {
      priceUsd: price,
      symbol: typeof v.symbol === "string" && v.symbol.trim() ? v.symbol.trim() : null,
      confidence: typeof v.confidence === "number" && Number.isFinite(v.confidence) ? v.confidence : null,
      at: seconds && seconds > 0 ? new Date(seconds * 1000) : null,
    });
  }
  return out;
}

/**
 * Взять число как опору — только при сошедшемся тикере и достаточном согласии
 * источников. Ключ, указывающий не на ту монету, опорой быть не может: это ровно
 * та ошибка, от которой опора и защищает.
 */
export function pickReference(row: LlamaPrice | undefined, expectedSymbol: string): number | null {
  if (!row) return null;
  if (!row.symbol || row.symbol.toUpperCase() !== expectedSymbol.trim().toUpperCase()) return null;
  if (row.confidence !== null && row.confidence < DL_MIN_CONFIDENCE) return null;
  return row.priceUsd;
}

export class DlHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`defillama ${path} ${status}: ${body.slice(0, 200)}`);
    this.name = "DlHttpError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

const sharedGate = createRateGate({ minIntervalMs: DL_MIN_INTERVAL_MS });

function retryable(err: unknown): boolean {
  if (err instanceof DlHttpError) return err.retryable;
  return true;
}

export type DlGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  timeoutMs?: number;
  scope?: QuotaScope;
};

async function dlGet(path: string, opts: DlGetOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonFetch);
  const gate = opts.gate ?? sharedGate;
  const scope = opts.scope ?? "bg";
  const timeoutMs = opts.timeoutMs ?? DL_TIMEOUT_MS;

  const once = async (): Promise<unknown> => {
    void countCall("defillama", scope);
    const res = await fetchImpl(`${DL_BASE}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DlHttpError(res.status, path, body);
    }
    return res.json();
  };

  return gate.run(() =>
    withRetry(once, { delaysMs: DL_RETRY_DELAYS_MS, retryable, sleep: opts.sleep, jitter: opts.jitter }),
  );
}

/** Цены пачками по `DL_BATCH`: сбой одной пачки остальные не роняет. */
export async function fetchLlamaPrices(coinIds: string[], opts: DlGetOptions = {}): Promise<Map<string, LlamaPrice>> {
  const out = new Map<string, LlamaPrice>();
  for (let i = 0; i < coinIds.length; i += DL_BATCH) {
    const batch = coinIds.slice(i, i + DL_BATCH);
    if (batch.length === 0) continue;
    const path = `/prices/current/${batch.map((id) => encodeURIComponent(llamaKey(id))).join(",")}`;
    try {
      for (const [k, v] of parseLlamaPrices(await dlGet(path, opts))) out.set(k, v);
    } catch {
      // Опора — удобство, а не обязанность: нет ответа, карточка просто не сеется.
    }
  }
  return out;
}
