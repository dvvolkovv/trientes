/**
 * Сколько вызовов чужой службы нам можно и сколько осталось — чистым счётом,
 * без Redis и без Prisma.
 *
 * Зачем файл. 19 ноября запас CoinPaprika кончился на середине месяца, и узнали
 * мы это тем, что страница биржи стала отдаваться 50 секунд, а веб падал по
 * памяти. Уборка BH сбила расход, но сбила его **пришпиленным числом** —
 * `detailCallBudget: 11`. Пришпиленное число не знает ни про остаток месяца, ни
 * про то, сколько в этом месяце прочитали живые страницы: оно одинаково и в
 * первый день, и в последний.
 *
 * Здесь остаток делится сам. Два числа хранятся раздельно и путать их нельзя:
 * **запас службы** (месячный, её) и **доля фона** (наша, суточная). Сложи их — и
 * дневной всплеск посетителей выглядел бы как перерасход прогонов, а прогоны —
 * как нагрузку посетителей.
 */

export type QuotaScope = "bg" | "ui";

export type QuotaService = {
  /** Ключ в счётчике и в отчёте. */
  key: string;
  /** Как служба называется человеку. */
  label: string;
  /** Месячный запас самой службы. null — месячного запаса нет вовсе. */
  upstreamMonthly: number | null;
  /**
   * Наш запас на месяц — **ниже настоящего**: служба считает по адресу, то есть
   * вместе с тем, чего мы не видим (ручной запрос с той же машины, запросы до
   * появления счётчика), а запись на пути посетителя не ожидается. Наше число —
   * нижняя граница истраченного, и разница должна помещаться в зазор.
   */
  monthlyBudget: number | null;
  /** Доля месячного запаса, оставленная живым страницам (0..1). */
  visitorReserve: number;
  /**
   * Предел фона на сутки. У службы без месячного запаса это единственный предел,
   * и он **наш собственный** — защита от разгона в цикле, а не её правило.
   */
  dailyBackgroundCap: number | null;
};

/** Реестр служб — в коде, как лист проверок в AP и лестница уровней в BD. */
export const QUOTA_SERVICES = {
  coinpaprika: {
    key: "coinpaprika",
    label: "CoinPaprika",
    upstreamMonthly: 20_000,
    monthlyBudget: 16_000,
    visitorReserve: 0.25,
    dailyBackgroundCap: null,
  },
  coingecko: {
    key: "coingecko",
    label: "CoinGecko",
    upstreamMonthly: null,
    monthlyBudget: null,
    visitorReserve: 0,
    dailyBackgroundCap: 600,
  },
  coinlore: {
    key: "coinlore",
    label: "Coinlore",
    upstreamMonthly: null,
    monthlyBudget: null,
    visitorReserve: 0,
    dailyBackgroundCap: 400,
  },
  defillama: {
    key: "defillama",
    label: "DefiLlama",
    upstreamMonthly: null,
    monthlyBudget: null,
    visitorReserve: 0,
    dailyBackgroundCap: 200,
  },
} as const satisfies Record<string, QuotaService>;

export type QuotaServiceKey = keyof typeof QUOTA_SERVICES;

/** Все окна считаются по UTC: сервер и счётчик обязаны делить одни сутки. */
export function daysInMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Сутки до конца месяца, считая сегодняшние. */
export function daysLeftInMonth(now: Date): number {
  return daysInMonth(now) - now.getUTCDate() + 1;
}

/** Прошедшие сутки месяца, считая сегодняшние: делитель прогноза. */
export function daysElapsedInMonth(now: Date): number {
  return now.getUTCDate();
}

/** Прогонов до конца суток, считая текущий час. */
export function runsLeftToday(now: Date, runsPerDay: number): number {
  if (runsPerDay <= 1) return 1;
  const perHour = runsPerDay / 24;
  const hoursLeft = 24 - now.getUTCHours();
  return Math.max(1, Math.round(hoursLeft * perHour));
}

/** Доля фона на месяц: наш запас минус броня живым страницам. */
export function backgroundMonthlyAllowance(service: QuotaService): number | null {
  if (service.monthlyBudget === null) return null;
  return Math.floor(service.monthlyBudget * (1 - service.visitorReserve));
}

/** Сколько фон может истратить за сегодня: остаток месяца, делённый на сутки. */
export function dailyBackgroundAllowance(service: QuotaService, bgSpentMonth: number, now: Date): number {
  const monthly = backgroundMonthlyAllowance(service);
  if (monthly === null) return service.dailyBackgroundCap ?? 0;
  const left = Math.max(0, monthly - bgSpentMonth);
  const byMonth = Math.floor(left / daysLeftInMonth(now));
  return service.dailyBackgroundCap === null ? byMonth : Math.min(byMonth, service.dailyBackgroundCap);
}

export type RunBudgetReason = "ok" | "budget_spent" | "daily_cap" | "no_room";

export type RunBudget = {
  /** Можно ли прогону звонить вообще. */
  allowed: boolean;
  /** Сколько вызовов сверх постоянной цены прогона он может сделать. */
  calls: number;
  reason: RunBudgetReason;
};

/**
 * Сколько вызовов отдать одному прогону. `fixedCostPerRun` — то, что прогон
 * тратит всегда (у обхода каталога это один запрос списка): его цена снимается
 * с бюджета первой, иначе прогон с нулевой долей всё равно звонил бы разок.
 */
export function runBudget(args: {
  service: QuotaService;
  bgSpentMonth: number;
  bgSpentToday: number;
  uiSpentMonth: number;
  runsPerDay: number;
  fixedCostPerRun: number;
  perRunCap: number;
  now: Date;
}): RunBudget {
  const { service, bgSpentMonth, bgSpentToday, uiSpentMonth, runsPerDay, fixedCostPerRun, perRunCap, now } = args;

  // Жёсткая граница: весь наш запас истрачен — остаток до настоящего потолка
  // принадлежит живым страницам, и фон молчит, даже не выбрав своей доли.
  if (service.monthlyBudget !== null && bgSpentMonth + uiSpentMonth >= service.monthlyBudget) {
    return { allowed: false, calls: 0, reason: "budget_spent" };
  }

  const daily = dailyBackgroundAllowance(service, bgSpentMonth, now);
  const leftToday = daily - bgSpentToday;
  if (leftToday <= 0) {
    return { allowed: false, calls: 0, reason: service.monthlyBudget === null ? "daily_cap" : "no_room" };
  }

  const perRun = Math.floor(leftToday / runsLeftToday(now, runsPerDay)) - fixedCostPerRun;
  if (perRun < 0) return { allowed: leftToday > fixedCostPerRun, calls: 0, reason: "no_room" };
  return { allowed: true, calls: Math.min(perRun, perRunCap), reason: "ok" };
}

/** Расход к концу месяца по нынешнему темпу. */
export function projectedMonthSpend(spentMonth: number, now: Date): number {
  const elapsed = daysElapsedInMonth(now);
  if (elapsed <= 0) return spentMonth;
  return Math.round((spentMonth / elapsed) * daysInMonth(now));
}

export type BudgetVerdict = {
  /** `quiet` — в отчёт не идёт: двадцать одинаковых строк перестают читать (AA). */
  level: "quiet" | "loud";
  spent: number;
  budget: number | null;
  remaining: number | null;
  projected: number;
  /** Дата, на которую запас кончится при нынешнем темпе. null — не кончится. */
  exhaustsOn: Date | null;
};

/** Доля запаса, после которой строка печатается всегда. */
export const VERDICT_LOUD_SHARE = 0.5;

export function budgetVerdict(service: QuotaService, spentMonth: number, now: Date): BudgetVerdict {
  const budget = service.monthlyBudget;
  const projected = projectedMonthSpend(spentMonth, now);
  const remaining = budget === null ? null : Math.max(0, budget - spentMonth);

  let exhaustsOn: Date | null = null;
  if (budget !== null && spentMonth > 0) {
    const perDay = spentMonth / daysElapsedInMonth(now);
    const daysToWall = Math.ceil((budget - spentMonth) / perDay);
    const day = daysElapsedInMonth(now) + daysToWall;
    if (day <= daysInMonth(now)) exhaustsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  }

  const loud =
    (budget !== null && (spentMonth >= budget * VERDICT_LOUD_SHARE || projected > budget)) ||
    (budget === null &&
      service.dailyBackgroundCap !== null &&
      projected > service.dailyBackgroundCap * daysInMonth(now) * VERDICT_LOUD_SHARE);

  return { level: loud ? "loud" : "quiet", spent: spentMonth, budget, remaining, projected, exhaustsOn };
}
