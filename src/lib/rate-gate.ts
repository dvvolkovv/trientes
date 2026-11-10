/**
 * Шлюз частоты запросов к внешнему API: очередь на один запрос за раз плюс
 * минимальный промежуток между началами запросов, и повтор с разбросом.
 *
 * Зачем отдельный файл. Воркер в `5,35 * * * *` запускал четыре прогона
 * CoinGecko (`global`, `rates`, `exchanges`, `admin-added`) одним залпом —
 * четыре параллельных запроса в одну секунду. Бесплатный тариф отвечал на них
 * 429, и дальше происходило худшее: прежний повтор был один и с постоянной
 * задержкой 15 с, поэтому все четыре повтора уходили **в ту же секунду** и
 * ловили 429 второй раз. В логах это видно буквально — 02:35:15 и 03:35:15,
 * четыре строки с одной отметкой времени.
 *
 * Отсюда две части этого файла:
 *
 * - `createRateGate` — очередь внутри процесса. Промежуток считается от
 *   **начала** предыдущего запроса, а не от конца: лимит внешнего API считает
 *   запросы в минуту, и запрос, который сам шёл три секунды, уже оплатил
 *   промежуток.
 * - `withRetry` — повтор с разбросом (`jitter`): задержка растягивается в
 *   пределах 0,5–1,5 от названной. Без разброса одновременно упавшие запросы
 *   возвращаются синхронно и давят лимит снова.
 *
 * Сон и часы инъектируются, чтобы тесты шли мгновенно и не зависели от
 * настоящего таймера — тот же приём, что в `bitcoin-rest`.
 *
 * Шлюз живёт **в процессе**, а лимит CoinGecko считается по IP, то есть
 * общий у `trientes-web` и `trientes-worker`. Полностью согласовать их мог бы
 * только счётчик в Redis; это лишняя точка отказа на пути пользовательского
 * графика, поэтому пока два независимых шлюза — залп внутри воркера они
 * убирают, а это и есть измеренная причина сбоев.
 */

export type Sleep = (ms: number) => Promise<void>;

/**
 * Минимальная форма `fetch`, которой хватает размеренным клиентам. Объявлена
 * здесь, а не в одном из них: иначе клиент CoinPaprika импортировал бы тип из
 * файла CoinGecko, хотя общего у них только гигиена исходящих запросов.
 */
export type JsonFetch = (
  url: string,
  init?: { headers?: Record<string, string>; cache?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type RateGate = {
  /** Поставить запрос в очередь. Значение и сбой задачи пробрасываются как есть. */
  run<T>(task: () => Promise<T>): Promise<T>;
};

export function createRateGate(opts: {
  minIntervalMs: number;
  sleep?: Sleep;
  now?: () => number;
}): RateGate {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => Date.now());
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const wait = lastStart + opts.minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        lastStart = now();
        return task();
      });
      // Хвост очереди не должен нести чужой сбой: иначе первая же ошибка
      // отклонила бы все последующие запросы, не выполнив их.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

export async function withRetry<T>(
  task: () => Promise<T>,
  opts: {
    /** Задержки перед повторами: длина массива — число повторов. */
    delaysMs: number[];
    retryable: (err: unknown) => boolean;
    sleep?: Sleep;
    /** 0..1; по умолчанию случайный. Задержка = base * (0,5 + jitter). */
    jitter?: () => number;
  },
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const jitter = opts.jitter ?? Math.random;

  let last: unknown;
  for (let attempt = 0; attempt <= opts.delaysMs.length; attempt++) {
    try {
      return await task();
    } catch (err) {
      last = err;
      if (!opts.retryable(err)) throw err;
      const base = opts.delaysMs[attempt];
      if (base === undefined) break;
      await sleep(Math.round(base * (0.5 + jitter())));
    }
  }
  throw last;
}
