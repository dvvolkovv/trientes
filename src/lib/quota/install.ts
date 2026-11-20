/**
 * Установить счётчик вызовов на процесс. Зовётся один раз — из воркера и из
 * `instrumentation.ts` веба; повторный вызов безвреден (ставится та же функция).
 */

import { redis } from "@/lib/redis";

import { setQuotaCounter } from "./count";
import { noteCall } from "./ledger";

export function installQuotaCounter(): void {
  setQuotaCounter(async (service, scope) => {
    await noteCall(redis, service, scope, new Date());
  });
}
