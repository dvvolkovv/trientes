/**
 * Мост между дверями чужих служб и счётчиком.
 *
 * Шлюзы (`coingecko-http`, `coinpaprika-http`, клиенты Coinlore и DefiLlama)
 * нарочно не знают ни Redis, ни Prisma: они проверяются тестом с подставным
 * `fetch`, и тащить в них соединение значило бы заводить его в каждом тесте.
 * Поэтому счётчик **устанавливается** один раз при старте процесса
 * (`src/lib/quota/install.ts`), а двери зовут его через этот мост. Не установлен
 * — вызовы идут молча, и это законное состояние: так в тестах и в скриптах.
 *
 * Запись **не ожидается** на пути посетителя: разбор в `rate-gate.ts` прямо
 * называет Redis на пути пользовательского графика лишней точкой отказа.
 */

import type { QuotaScope } from "./budget";

export type QuotaCounter = (service: string, scope: QuotaScope) => Promise<void>;

/**
 * Счётчик живёт на `globalThis`, а не в переменной модуля — и это не вкусовщина,
 * а живой дефект, пойманный прогоном 20 ноября.
 *
 * Next собирает серверный код **бандлами**, и один и тот же модуль существует в
 * нескольких экземплярах: `instrumentation.ts` поставил счётчик в своём, а
 * маршрут графика вызвал `countCall` в чужом — и вызов, честно ушедший в
 * CoinGecko (ответ 429 из живого запроса), в расход не попал. То есть броня
 * посетителям считалась бы от нуля весь месяц.
 *
 * Тот же приём уже стоит в `src/lib/redis.ts` и `prisma.ts` по той же причине.
 */
const slot = globalThis as unknown as { __trientesQuotaCounter?: QuotaCounter | null };

export function setQuotaCounter(fn: QuotaCounter): void {
  slot.__trientesQuotaCounter = fn;
}

export function resetQuotaCounter(): void {
  slot.__trientesQuotaCounter = null;
}

/** Отметить ушедший в сеть вызов. Сбой счёта вызова не роняет. */
export async function countCall(service: string, scope: QuotaScope): Promise<void> {
  const counter = slot.__trientesQuotaCounter;
  if (!counter) return;
  try {
    await counter(service, scope);
  } catch {
    // Счётчик дешевле запроса.
  }
}
