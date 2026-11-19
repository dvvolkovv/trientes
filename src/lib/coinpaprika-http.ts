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
 *
 * Но у 402 есть вторая причина, и она противоположная. 19 ноября запас месяца
 * кончился совсем («has 20000 monthly requests limit, your requests rate is:
 * 20003»), и повтор через 10 и 30 секунд не помогал ничему: месяц за сорок
 * секунд не кончается. Страница биржи зовёт подробности при отрисовке — она
 * стала отдаваться 50 секунд, обход поисковика по двенадцати языкам разом
 * догонял веб до 800 МБ, pm2 перезапускал его по памяти, и все посетители
 * получали 502. Поэтому служба различает два 402 **по телу ответа**: счётчик
 * меньше предела — задета частота, повторяем; счётчик достиг предела — запас
 * месяца исчерпан, повторять нельзя, и до обновления запаса звонить некуда.
 */

import { createRateGate, withRetry, type JsonFetch, type RateGate, type Sleep } from "./rate-gate";

export const CP_BASE = "https://api.coinpaprika.com/v1";

/** Прогон делает ~26 запросов подряд; промежуток держит их редкой струйкой. */
export const CP_MIN_INTERVAL_MS = 500;

/**
 * Срок одного запроса. Служба, принявшая соединение и замолчавшая, без него
 * держала бы отрисовку страницы ровно столько, сколько молчит: своего срока у
 * `fetch` нет. Десять секунд — заведомо больше живого ответа (доли секунды) и
 * заведомо меньше терпения посетителя; страницу всё равно охраняет её
 * собственный срок в три секунды (`exchange-fresh`).
 */
export const CP_TIMEOUT_MS = 10_000;
export const CP_RETRY_DELAYS_MS = [10_000, 30_000];

/**
 * Сколько молчать после исчерпанного запаса месяца. Шесть часов — не срок
 * обновления запаса (он месячный, и календарный он или скользящий, служба не
 * говорит), а цена проверки: четыре запроса в сутки, чтобы заметить обновление
 * само, без нашего участия. Запоминается в процессе, а не в Redis: веб и воркер
 * ходят каждый своей дорогой, и каждому хватает одного 402, чтобы замолчать.
 */
export const CP_QUOTA_BLOCK_MS = 6 * 60 * 60 * 1000;

/** Разбор тела 402: исчерпан запас месяца или задета частота. */
export function quotaExhaustedBody(body: string): boolean {
  // Числа ограничены формой «20000» и «20003.000000»: `[\d.]+` захватывал бы и
  // точку конца предложения, а `Number("20003.000000.")` — это NaN (поймано тестом).
  const m = /has\s+(\d+(?:\.\d+)?)\s+monthly requests limit[^:]*:\s*(\d+(?:\.\d+)?)/i.exec(body);
  if (!m) return false;
  const limit = Number(m[1]);
  const used = Number(m[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return false;
  return used >= limit;
}

let blockedUntil = 0;

/** До какого времени (мс эпохи) запросы не уходят в сеть. 0 — запрет снят. */
export function cpQuotaBlockedUntil(): number {
  return blockedUntil;
}

/** Снять запрет — для тестов и для ручного прогона после смены тарифа. */
export function resetCpQuotaBlock(): void {
  blockedUntil = 0;
}

/** Запрос не ушёл в сеть: запас месяца исчерпан и ещё не проверялся заново. */
export class CpQuotaBlockedError extends Error {
  constructor(readonly path: string, readonly until: number) {
    super(`coinpaprika ${path}: monthly quota exhausted, not calling until ${new Date(until).toISOString()}`);
    this.name = "CpQuotaBlockedError";
  }
}

/**
 * Отказ относится ко всей службе, а не к тому, что мы просили: запас месяца
 * исчерпан. Такой отказ нельзя считать «у этой биржи данных нет» — 19 ноября
 * именно это и вышло: подробности отвечали 402 всем десяти биржам прогона,
 * `fetchDetail` молчание превращал в null, прогон писал «ok», и ночной отчёт
 * сказал бы, что служба здорова.
 */
export function isCpQuotaError(err: unknown): boolean {
  if (err instanceof CpQuotaBlockedError) return true;
  return err instanceof CpHttpError && err.quotaExhausted;
}

export class CpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`coinpaprika ${path} ${status}: ${body.slice(0, 200)}`);
    this.name = "CpHttpError";
  }

  /** Запас месяца кончился: повтор через секунды не поможет, месяц не кончится. */
  get quotaExhausted(): boolean {
    return this.status === 402 && quotaExhaustedBody(this.body);
  }

  get retryable(): boolean {
    if (this.quotaExhausted) return false;
    return this.status === 402 || this.status === 429 || this.status >= 500;
  }
}

export type CpGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  retryDelaysMs?: number[];
  now?: () => number;
  timeoutMs?: number;
};

const sharedGate = createRateGate({ minIntervalMs: CP_MIN_INTERVAL_MS });

function retryable(err: unknown): boolean {
  if (err instanceof CpHttpError) return err.retryable;
  return true;
}

export async function cpGet(path: string, opts: CpGetOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonFetch);
  const gate = opts.gate ?? sharedGate;
  const now = opts.now ?? (() => Date.now());
  const url = `${CP_BASE}${path}`;

  if (blockedUntil > now()) throw new CpQuotaBlockedError(path, blockedUntil);

  const timeoutMs = opts.timeoutMs ?? CP_TIMEOUT_MS;
  const once = async (): Promise<unknown> => {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new CpHttpError(res.status, path, body);
    }
    return res.json();
  };

  const guarded = async (): Promise<unknown> => {
    try {
      return await once();
    } catch (err) {
      if (err instanceof CpHttpError && err.quotaExhausted) blockedUntil = now() + CP_QUOTA_BLOCK_MS;
      throw err;
    }
  };

  return gate.run(() =>
    withRetry(guarded, {
      delaysMs: opts.retryDelaysMs ?? CP_RETRY_DELAYS_MS,
      retryable,
      sleep: opts.sleep,
      jitter: opts.jitter,
    }),
  );
}
