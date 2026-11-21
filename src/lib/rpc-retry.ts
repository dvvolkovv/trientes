/**
 * Правило повторов для чтения чужого узла — одно на все четыре семьи сетей.
 *
 * Выношено из `bitcoin-rest` в уборке BR. Там оно родилось из живого замера
 * Litecoin: `litecoinspace.org` за Cloudflare отдаёт 520/525 **пачками** по
 * пять-одиннадцать подряд при половине удачных ответов в целом, то есть
 * повтор надо мерить временем, а не попытками. Остальные семьи жили с одной
 * немедленной повторной попыткой, и 21 ноября это стоило карточки Moonriver:
 * `rpc_unreachable` в прогоне, при котором живой запрос тем же методом
 * проходит за 0,3 с — публичный узел просто срезал нас по частоте.
 *
 * Повторы считаются **по классу отказа**:
 *   • быстрый отказ (у `RpcError` есть `detail` вида «http 429») приходит
 *     мгновенно и пачками — его пережидают окном времени с паузой;
 *   • медленный (обрыв, таймаут) стоит целый таймаут за попытку — ему дано
 *     число попыток, а не время.
 *
 * Пауза нужна и быстрому: 525 — это сбой рукопожатия Cloudflare с источником,
 * а 429 — окно частоты, и мгновенный повтор попадает в то же состояние.
 */

import { RpcError } from "./json-rpc";

export type RetryPolicy = {
  /** Повторов для медленного отказа (обрыв, таймаут). По умолчанию один. */
  retries?: number;
  /** Пауза перед повтором. 0 — в тестах. */
  backoffMs?: number;
  /** Окно, в котором пережидается пачка быстрых отказов. */
  statusBudgetMs?: number;
};

/**
 * Больше этого числа попыток по одному запросу не делается ни при каком окне:
 * отказ бывает мгновенным, и без потолка цикл бился бы о узел тысячи раз.
 */
export const MAX_ATTEMPTS = 15;

/**
 * Окно и пауза по умолчанию. Они разные у семей, и это не вкус, а замер:
 *
 * • у семьи Bitcoin отказ приходит **пачками** по пять-одиннадцать подряд
 *   (живой замер Litecoin, уборка BO) — там окно 8 с, и `bitcoin-rest` его
 *   задаёт сам;
 * • у публичных узлов Substrate, Cosmos и EVM наблюдался одиночный отказ по
 *   частоте, после которого узел отвечает через доли секунды (Moonriver,
 *   21 ноября). Для него хватает двух с половиной секунд, а больше нельзя:
 *   чтение карточки — шесть-восемь запросов подряд, и щедрое окно умножало бы
 *   время часового прогона по 55 карточкам.
 */
export const DEFAULT_STATUS_BUDGET_MS = 2_500;
export const DEFAULT_BACKOFF_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Быстрый ли это отказ: у него в `detail` стоит статус ответа. */
export function isFastFailure(err: unknown): boolean {
  return err instanceof RpcError && (err.detail?.startsWith("http ") ?? false);
}

/**
 * Один запрос с повторами по правилу выше. `run` обязан бросать `RpcError`:
 * повторяется только `rpc_unreachable` — `rpc_error` это ответ узла о сети, он
 * воспроизведётся, а `decode_failed` означает, что форма ответа не наша.
 */
export async function withRpcRetry<T>(run: () => Promise<T>, policy: RetryPolicy = {}): Promise<T> {
  const backoffMs = policy.backoffMs ?? DEFAULT_BACKOFF_MS;
  const statusBudgetMs = policy.statusBudgetMs ?? DEFAULT_STATUS_BUDGET_MS;
  const startedAt = Date.now();
  let slowLeft = policy.retries ?? 1;

  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof RpcError) || err.code !== "rpc_unreachable") throw err;
      const mayRetry = isFastFailure(err)
        ? Date.now() - startedAt < statusBudgetMs
        : slowLeft-- > 0;
      if (!mayRetry || attempt >= MAX_ATTEMPTS) throw err;
      if (backoffMs > 0) await sleep(backoffMs);
    }
  }
}
