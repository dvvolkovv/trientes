/**
 * Один вход для всех запросов к CoinGecko: промежуток между запросами,
 * классификация сбоя и повтор с разбросом.
 *
 * Прежний `cgFetch` жил внутри `coingecko.ts`, работал с глобальным `fetch` и
 * повторялся один раз через ровно 15 секунд. Вынесено отдельно по двум
 * причинам: шлюз частоты должен быть **один на процесс** (иначе каждый вызов
 * считает промежуток сам и залп повторяется), и такой код надо проверять
 * тестом, а значит `fetch`, сон и разброс нужно инъектировать.
 *
 * Классификация сбоя — как в семье Bitcoin (`bitcoin-rest`), и по той же
 * причине: **429 и 5xx — это «приходи позже»** (повторяем), **остальные 4xx —
 * ответ сервиса** (повторять нечего, у `/coins/нет-такой-монеты` второй запрос
 * даст тот же 404). Обрыв связи и ответ не-JSON (страница балансировщика
 * вместо данных) тоже считаются «позже».
 *
 * Задержки 15 и 45 секунд названы так, чтобы пережить минутное окно лимита:
 * первый повтор уходит внутрь того же окна, второй — уже в следующее.
 */

import { createRateGate, withRetry, type JsonFetch, type RateGate, type Sleep } from "./rate-gate";

export type { JsonFetch };

export const CG_BASE = "https://api.coingecko.com/api/v3";

/** Промежуток между запросами. Воркер делает единицы запросов в минуту —
 *  промежуток нужен не чтобы замедлить, а чтобы развести одновременные. */
export const CG_MIN_INTERVAL_MS = 1_200;
export const CG_RETRY_DELAYS_MS = [15_000, 45_000];

/**
 * Пользовательские чтения (тикеры монеты при отрисовке страницы, точки
 * графика) ходят своей очередью и со своим расписанием повторов.
 *
 * Иначе очередь работает против посетителя: фоновый запрос каталога идёт по
 * живому замеру около трёх секунд, а ожидание после 429 — пятнадцать и сорок
 * пять, и страница монеты, промахнувшаяся мимо кэша, честно простояла бы
 * минуту вместо того, чтобы отрисоваться без таблицы рынков. Поэтому здесь
 * промежуток короткий, а повтор один и быстрый: не вышло — вызывающий код
 * обходится без этих данных (`readTickers` отдаёт пустой список, маршрут
 * графика — 502), и это лучше, чем ждать.
 */
export const CG_UI_MIN_INTERVAL_MS = 250;
export const CG_UI_RETRY_DELAYS_MS = [1_500];

export class CgHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`coingecko ${path} ${status}: ${body.slice(0, 200)}`);
    this.name = "CgHttpError";
  }

  /** 429 и 5xx — про частоту и доступность, остальные коды — про сам запрос. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export type CgGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  retryDelaysMs?: number[];
};

/** Общий шлюз процесса: все вызовы без своего `gate` выстраиваются в него. */
const sharedGate = createRateGate({ minIntervalMs: CG_MIN_INTERVAL_MS });
const uiGate = createRateGate({ minIntervalMs: CG_UI_MIN_INTERVAL_MS });

function retryable(err: unknown): boolean {
  if (err instanceof CgHttpError) return err.retryable;
  // Обрыв, таймаут, не-JSON — связь, а не суждение сервиса.
  return true;
}

export async function cgGet(
  path: string,
  params: Record<string, string>,
  opts: CgGetOptions = {},
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as JsonFetch);
  const gate = opts.gate ?? sharedGate;
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${CG_BASE}${path}?${qs}` : `${CG_BASE}${path}`;

  const once = async (): Promise<unknown> => {
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new CgHttpError(res.status, path, body);
    }
    return res.json();
  };

  // Повтор — **внутри** шлюза: пока мы ждём после 429, остальные запросы
  // стоят в очереди и не добавляют давления на тот же лимит.
  return gate.run(() =>
    withRetry(once, {
      delaysMs: opts.retryDelaysMs ?? CG_RETRY_DELAYS_MS,
      retryable,
      sleep: opts.sleep,
      jitter: opts.jitter,
    }),
  );
}

/** Чтение по запросу посетителя: отдельная очередь, один быстрый повтор. */
export async function cgGetUi(
  path: string,
  params: Record<string, string>,
  opts: CgGetOptions = {},
): Promise<unknown> {
  return cgGet(path, params, {
    gate: opts.gate ?? uiGate,
    retryDelaysMs: opts.retryDelaysMs ?? CG_UI_RETRY_DELAYS_MS,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    jitter: opts.jitter,
  });
}
