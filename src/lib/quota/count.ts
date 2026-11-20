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

let counter: QuotaCounter | null = null;

export function setQuotaCounter(fn: QuotaCounter): void {
  counter = fn;
}

export function resetQuotaCounter(): void {
  counter = null;
}

/** Отметить ушедший в сеть вызов. Сбой счёта вызова не роняет. */
export async function countCall(service: string, scope: QuotaScope): Promise<void> {
  if (!counter) return;
  try {
    await counter(service, scope);
  } catch {
    // Счётчик дешевле запроса.
  }
}
