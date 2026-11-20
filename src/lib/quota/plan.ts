/**
 * Что прогону можно прямо сейчас: прочитать расход и посчитать бюджет.
 *
 * Отдельно от `budget.ts` потому, что тот — чистый счёт без Redis, и таким он
 * проверяется тестом; отдельно от `ledger.ts` потому, что тот не знает про
 * реестр служб.
 */

import { runBudget, type QuotaService, type RunBudgetReason } from "./budget";
import { readSpend } from "./ledger";

type RedisLike = Parameters<typeof readSpend>[0];

export type RunPlanReason = RunBudgetReason | "no_ledger";

export type RunPlan = { allowed: boolean; calls: number; reason: RunPlanReason };

export async function planRun(
  redis: RedisLike,
  service: QuotaService,
  opts: { runsPerDay: number; fixedCostPerRun: number; perRunCap: number; now?: Date },
): Promise<RunPlan> {
  const now = opts.now ?? new Date();
  const spend = await readSpend(redis, service.key, now);
  // Нет счётчика — остаток неизвестен, и фон не идёт. Посетителю в такой же беде
  // мы не отказываем (его запросов единицы, и отказ ему — пустая страница), а
  // прогон подождёт час: запас считается месяцем. Эта асимметрия и есть броня
  // живых страниц, о которой просил владелец.
  if (!spend) return { allowed: false, calls: 0, reason: "no_ledger" };

  const b = runBudget({
    service,
    bgSpentMonth: spend.bgMonth,
    bgSpentToday: spend.bgToday,
    uiSpentMonth: spend.uiMonth,
    runsPerDay: opts.runsPerDay,
    fixedCostPerRun: opts.fixedCostPerRun,
    perRunCap: opts.perRunCap,
    now,
  });
  return { allowed: b.allowed, calls: b.calls, reason: b.reason };
}
