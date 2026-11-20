/**
 * Coinlore — бесплатный источник пар бирж: ключа нет, месячного запаса нет,
 * документированный предел — запрос в секунду. Живая проверка 20 ноября с нашего
 * адреса: список из 141 биржи одним запросом за 0,05 с (`name_id`, `volume_usd`,
 * `active_pairs`, `url`, `country`), пары биржи — сто строк с ценой в долларах,
 * объёмом в долларах и временем снимка.
 *
 * Зачем он нужен. `ExchangeMarket` пуста у всех 581 бирж с начала проекта: её
 * наполняли подробности CoinPaprika, и именно они съедали месячный запас (слайс
 * AD записал пустую таблицу, уборка BH — исчерпанный запас). То, за чем мы туда
 * ходим — число пар и сами пары, — Coinlore отдаёт даром.
 *
 * Чего он не делает: **новых бирж не заводит**. Каталог и так наполняют два
 * источника, и живая проверка показала цену этого — в базе лежат `gate` и
 * `gateio`, `bybit_spot` и `bybit-spot`, `uniswap_v2` и `uniswap-v2`: одна биржа
 * двумя строками. Третий автор каталога умножил бы это, а строке новой биржи
 * нужны логотип и опознание, которых Coinlore не даёт (её id — число).
 */

import { z } from "zod";

import { countCall } from "./quota/count";
import type { QuotaScope } from "./quota/budget";
import { createRateGate, withRetry, type JsonFetch, type RateGate, type Sleep } from "./rate-gate";

export const CL_BASE = "https://api.coinlore.net/api";

/** Документированный предел службы — запрос в секунду. */
export const CL_MIN_INTERVAL_MS = 1_000;

/** Срок запроса: своего у `fetch` нет (граница — `tests/outbound-timeouts.test.ts`). */
export const CL_TIMEOUT_MS = 8_000;
export const CL_RETRY_DELAYS_MS = [2_000];

/**
 * Пара, не торговавшаяся неделю, не пишется вовсе: биржа её сняла. Шесть часов
 * (порог замерших пар в уборке AV) здесь не годятся — там число шло в ценовой
 * индекс, здесь пара только показывается на карточке биржи.
 */
export const PAIR_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export type CoinloreExchange = {
  /** Числовой id службы — нужен только чтобы спросить её же о парах. */
  id: string;
  name: string;
  nameId: string;
  volumeUsd: number | null;
  activePairs: number | null;
  url: string | null;
  country: string | null;
};

export type CoinlorePair = {
  base: string;
  quote: string;
  priceUsd: number | null;
  volumeUsd: number | null;
  tradedAt: Date | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const exchangeSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  name_id: z.string().min(1),
  volume_usd: z.unknown().optional(),
  active_pairs: z.unknown().optional(),
  url: z.string().nullish(),
  country: z.string().nullish(),
});

/** Ответ списка — объект, ключи которого равны id; строка не той формы выбрасывается. */
export function parseCoinloreExchanges(raw: unknown): CoinloreExchange[] {
  if (!raw || typeof raw !== "object") return [];
  const out: CoinloreExchange[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const r = exchangeSchema.safeParse(value);
    if (!r.success) continue;
    const d = r.data;
    out.push({
      id: String(d.id),
      name: d.name.trim(),
      nameId: d.name_id.trim(),
      volumeUsd: num(d.volume_usd),
      activePairs: num(d.active_pairs),
      url: d.url?.trim() || null,
      country: d.country?.trim() || null,
    });
  }
  return out;
}

const pairSchema = z.object({
  base: z.string().min(1),
  quote: z.string().min(1),
  price_usd: z.unknown().optional(),
  volume: z.unknown().optional(),
  time: z.unknown().optional(),
});

export function parseCoinlorePairs(raw: unknown): CoinlorePair[] {
  if (!raw || typeof raw !== "object") return [];
  const pairs = (raw as { pairs?: unknown }).pairs;
  if (!Array.isArray(pairs)) return [];
  const out: CoinlorePair[] = [];
  for (const value of pairs) {
    const r = pairSchema.safeParse(value);
    if (!r.success) continue;
    const seconds = num(r.data.time);
    out.push({
      base: r.data.base.trim().toUpperCase(),
      quote: r.data.quote.trim().toUpperCase(),
      priceUsd: num(r.data.price_usd),
      volumeUsd: num(r.data.volume),
      tradedAt: seconds && seconds > 0 ? new Date(seconds * 1000) : null,
    });
  }
  return out;
}

/**
 * Известные расхождения ключей, пришпиленные руками — тот же приём, что
 * `directoryId` в слайсе AD: id бирж у разных служб не выводятся друг из друга.
 */
export const COINLORE_ALIASES: Record<string, string> = {
  coinbase: "gdax", // наш id пришёл от CoinGecko, у которого Coinbase зовётся gdax
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type OurExchange = { id: string; name: string };

/**
 * Опознание — по ключу, а не по похожести. Порядок: пришпиленный псевдоним →
 * точный id → единственное совпадение нормализованного id → единственное
 * совпадение нормализованного имени → отказ.
 *
 * Неоднозначное имя — **отказ, а не выбор первого**. Живой замер показал цену
 * догадки: у Coinlore один `Uniswap` с 1140 парами, а в нашем каталоге ему
 * отвечают сорок строк по сети и версии; угадай — и агрегированные пары
 * достанутся одной случайной версии на одной случайной сети.
 */
export function matchExchange(cl: { nameId: string; name: string }, ours: OurExchange[]): string | null {
  const alias = COINLORE_ALIASES[cl.nameId];
  if (alias && ours.some((o) => o.id === alias)) return alias;

  const exact = ours.find((o) => o.id === cl.nameId);
  if (exact) return exact.id;

  const key = normalize(cl.nameId);
  const byId = ours.filter((o) => normalize(o.id) === key);
  if (byId.length === 1) return byId[0].id;

  const nameKey = normalize(cl.name);
  const byName = ours.filter((o) => normalize(o.name) === nameKey);
  if (byName.length === 1) return byName[0].id;

  return null;
}

export type CoinloreGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  timeoutMs?: number;
  scope?: QuotaScope;
};

export class ClHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`coinlore ${path} ${status}: ${body.slice(0, 200)}`);
    this.name = "ClHttpError";
  }

  /** 429 и 5xx — «приходи позже», остальные 4xx — ответ службы (та же схема, что у семьи Bitcoin). */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

const sharedGate = createRateGate({ minIntervalMs: CL_MIN_INTERVAL_MS });

function retryable(err: unknown): boolean {
  if (err instanceof ClHttpError) return err.retryable;
  return true;
}

async function clGet(path: string, opts: CoinloreGetOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonFetch);
  const gate = opts.gate ?? sharedGate;
  const scope = opts.scope ?? "bg";
  const url = `${CL_BASE}${path}`;
  const timeoutMs = opts.timeoutMs ?? CL_TIMEOUT_MS;

  const once = async (): Promise<unknown> => {
    void countCall("coinlore", scope);
    const res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ClHttpError(res.status, path, body);
    }
    return res.json();
  };

  return gate.run(() =>
    withRetry(once, { delaysMs: CL_RETRY_DELAYS_MS, retryable, sleep: opts.sleep, jitter: opts.jitter }),
  );
}

export async function fetchCoinloreExchanges(opts: CoinloreGetOptions = {}): Promise<CoinloreExchange[]> {
  return parseCoinloreExchanges(await clGet("/exchanges/", opts));
}

export async function fetchCoinlorePairs(id: string, opts: CoinloreGetOptions = {}): Promise<CoinlorePair[]> {
  return parseCoinlorePairs(await clGet(`/exchange/?id=${encodeURIComponent(id)}`, opts));
}
