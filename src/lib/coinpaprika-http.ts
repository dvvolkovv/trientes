/**
 * Один вход для запросов к CoinPaprika — тот же шлюз частоты и повтор с
 * разбросом, что у CoinGecko (`coingecko-http`), но со своей классификацией.
 *
 * Разница в одном коде, и она важна: **402 здесь означает «приходи позже»**.
 * Бесплатный тариф отвечает `402 Payment Required`, когда исчерпан запас
 * вызовов текущего окна, а не когда доступ закрыт навсегда — живой лог за
 * 9–10 ноября показывает пять таких ответов на `/exchanges` из сорока восьми
 * прогонов, остальные сорок три в те же сутки прошли. Прежний код повтора не
 * имел вовсе, и каждый такой ответ ронял весь прогон: `/exchanges` — первый
 * запрос цепочки, без него не делаются и двадцать пять запросов подробностей.
 */

import { createRateGate, withRetry, type JsonFetch, type RateGate, type Sleep } from "./rate-gate";

export const CP_BASE = "https://api.coinpaprika.com/v1";

/** Прогон делает ~26 запросов подряд; промежуток держит их редкой струйкой. */
export const CP_MIN_INTERVAL_MS = 500;
export const CP_RETRY_DELAYS_MS = [10_000, 30_000];

export class CpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`coinpaprika ${path} ${status}: ${body.slice(0, 200)}`);
    this.name = "CpHttpError";
  }

  get retryable(): boolean {
    return this.status === 402 || this.status === 429 || this.status >= 500;
  }
}

export type CpGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  retryDelaysMs?: number[];
};

const sharedGate = createRateGate({ minIntervalMs: CP_MIN_INTERVAL_MS });

function retryable(err: unknown): boolean {
  if (err instanceof CpHttpError) return err.retryable;
  return true;
}

export async function cpGet(path: string, opts: CpGetOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonFetch);
  const gate = opts.gate ?? sharedGate;
  const url = `${CP_BASE}${path}`;

  const once = async (): Promise<unknown> => {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new CpHttpError(res.status, path, body);
    }
    return res.json();
  };

  return gate.run(() =>
    withRetry(once, {
      delaysMs: opts.retryDelaysMs ?? CP_RETRY_DELAYS_MS,
      retryable,
      sleep: opts.sleep,
      jitter: opts.jitter,
    }),
  );
}
