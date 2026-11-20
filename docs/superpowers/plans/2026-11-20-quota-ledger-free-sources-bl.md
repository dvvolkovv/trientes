# Запас чужих служб: свой счёт, Coinlore, DefiLlama — план (слайс BL)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** считать свои вызовы к чужим службам, выводить из остатка размер фонового
прогона, заменить платящую запасом часть CoinPaprika бесплатными Coinlore и DefiLlama и
показать расход владельцу в ночном отчёте — до стены, а не после.

**Architecture:** чистый расчёт бюджета (`src/lib/quota/budget.ts`) отдельно от записи
счётчиков в Redis (`src/lib/quota/ledger.ts`); счёт увеличивается внутри единственной
двери каждой службы (`cgGet`, `cpGet`, новые шлюзы); прогоны читают остаток до работы,
посетитель счётчика не ждёт. Два новых клиента — `coinlore.ts` (пары бирж) и
`defillama.ts` (опора цены) — живут по образцу существующих: свой шлюз частоты, свой
срок, своя классификация сбоя.

**Tech Stack:** TypeScript, Next.js 16, Prisma/Postgres, ioredis, vitest, node-cron.

Спека: `docs/superpowers/specs/2026-11-20-quota-ledger-free-sources-design.md`.

---

### Task 1: расчёт бюджета — чистые функции

**Files:**
- Create: `src/lib/quota/budget.ts`
- Test: `tests/quota-budget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  QUOTA_SERVICES,
  backgroundMonthlyAllowance,
  dailyBackgroundAllowance,
  runBudget,
  daysInMonth,
  daysLeftInMonth,
  runsLeftToday,
  projectedMonthSpend,
  budgetVerdict,
} from "@/lib/quota/budget";

const nov = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h, 0, 0)); // ноябрь, 30 суток

describe("quota budget", () => {
  it("реестр служб: у CoinPaprika наш запас ниже настоящего", () => {
    const cp = QUOTA_SERVICES.coinpaprika;
    expect(cp.upstreamMonthly).toBe(20_000);
    expect(cp.monthlyBudget).toBe(16_000);
    expect(cp.monthlyBudget).toBeLessThan(cp.upstreamMonthly!);
  });

  it("у службы без месячного запаса предел суточный и он наш", () => {
    expect(QUOTA_SERVICES.coingecko.upstreamMonthly).toBeNull();
    expect(QUOTA_SERVICES.coingecko.dailyBackgroundCap).toBe(600);
  });

  it("календарь считается по UTC", () => {
    expect(daysInMonth(nov(20))).toBe(30);
    expect(daysLeftInMonth(nov(20))).toBe(11); // 20..30 включительно
    expect(daysLeftInMonth(nov(30))).toBe(1);
  });

  it("прогонов до конца суток считается от часа", () => {
    expect(runsLeftToday(nov(20, 0), 24)).toBe(24);
    expect(runsLeftToday(nov(20, 23), 24)).toBe(1);
    expect(runsLeftToday(nov(20, 12), 1)).toBe(1); // суточный прогон — всегда один
  });

  it("доля фона на месяц — запас минус броня посетителям", () => {
    expect(backgroundMonthlyAllowance(QUOTA_SERVICES.coinpaprika)).toBe(12_000);
  });

  it("суточная доля — остаток, делённый на сутки до конца месяца", () => {
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 0, nov(1))).toBe(400);
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 11_000, nov(20))).toBe(90);
  });

  it("истраченная доля даёт ноль, а не отрицательное число", () => {
    expect(dailyBackgroundAllowance(QUOTA_SERVICES.coinpaprika, 99_999, nov(20))).toBe(0);
  });

  it("бюджет прогона: месяц начался, прогон почасовой", () => {
    const b = runBudget({
      service: QUOTA_SERVICES.coinpaprika,
      bgSpentMonth: 0,
      bgSpentToday: 0,
      uiSpentMonth: 0,
      runsPerDay: 24,
      fixedCostPerRun: 1,
      perRunCap: 25,
      now: nov(1, 0),
    });
    expect(b.allowed).toBe(true);
    expect(b.calls).toBe(15); // 400/сутки ÷ 24 прогона = 16, минус вызов списка
  });

  it("бюджет прогона падает после тяжёлого дня посетителей", () => {
    const b = runBudget({
      service: QUOTA_SERVICES.coinpaprika,
      bgSpentMonth: 11_900,
      bgSpentToday: 80,
      uiSpentMonth: 0,
      runsPerDay: 24,
      fixedCostPerRun: 1,
      perRunCap: 25,
      now: nov(20, 12),
    });
    expect(b.calls).toBe(0);
  });

  it("жёсткая граница: истрачено всё вместе ≥ нашего запаса — фон молчит", () => {
    const b = runBudget({
      service: QUOTA_SERVICES.coinpaprika,
      bgSpentMonth: 8_000,
      bgSpentToday: 0,
      uiSpentMonth: 8_000,
      runsPerDay: 24,
      fixedCostPerRun: 1,
      perRunCap: 25,
      now: nov(10, 0),
    });
    expect(b.allowed).toBe(false);
    expect(b.calls).toBe(0);
    expect(b.reason).toBe("budget_spent");
  });

  it("потолок прогона не перешагивается даже при пустом месяце", () => {
    const b = runBudget({
      service: { ...QUOTA_SERVICES.coinpaprika, monthlyBudget: 1_000_000 },
      bgSpentMonth: 0,
      bgSpentToday: 0,
      uiSpentMonth: 0,
      runsPerDay: 24,
      fixedCostPerRun: 1,
      perRunCap: 25,
      now: nov(1, 0),
    });
    expect(b.calls).toBe(25);
  });

  it("служба без месячного запаса меряется суточным пределом", () => {
    const b = runBudget({
      service: QUOTA_SERVICES.coingecko,
      bgSpentMonth: 0,
      bgSpentToday: 600,
      uiSpentMonth: 0,
      runsPerDay: 144,
      fixedCostPerRun: 1,
      perRunCap: 5,
      now: nov(20, 12),
    });
    expect(b.allowed).toBe(false);
    expect(b.reason).toBe("daily_cap");
  });

  it("прогноз месяца считается по прошедшим суткам", () => {
    expect(projectedMonthSpend(1_000, nov(10, 12))).toBe(3_000); // 1000 за 10 суток
    expect(projectedMonthSpend(0, nov(1, 0))).toBe(0);
  });

  it("вердикт молчит, пока расход мал", () => {
    expect(budgetVerdict(QUOTA_SERVICES.coinpaprika, 1_000, nov(10, 12)).level).toBe("quiet");
  });

  it("вердикт говорит, когда истрачено больше половины", () => {
    const v = budgetVerdict(QUOTA_SERVICES.coinpaprika, 9_000, nov(20, 12));
    expect(v.level).toBe("loud");
    expect(v.spent).toBe(9_000);
    expect(v.remaining).toBe(7_000);
  });

  it("вердикт предупреждает о стене с датой", () => {
    const v = budgetVerdict(QUOTA_SERVICES.coinpaprika, 8_000, nov(10, 12));
    expect(v.level).toBe("loud");
    expect(v.projected).toBe(24_000);
    expect(v.exhaustsOn?.toISOString().slice(0, 10)).toBe("2026-11-20");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quota-budget.test.ts`
Expected: FAIL — `Cannot find module '@/lib/quota/budget'`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
 * дневной всплеск посетителей выглядел бы как перерасход прогонов.
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
    (budget === null && service.dailyBackgroundCap !== null && projected > service.dailyBackgroundCap * daysInMonth(now) * VERDICT_LOUD_SHARE);

  return { level: loud ? "loud" : "quiet", spent: spentMonth, budget, remaining, projected, exhaustsOn };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quota-budget.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quota/budget.ts tests/quota-budget.test.ts
git commit -m "feat(запас): расчёт бюджета вызовов чужих служб"
```

---

### Task 2: счётчик вызовов в Redis

**Files:**
- Create: `src/lib/quota/ledger.ts`
- Test: `tests/quota-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { monthWindow, dayWindow, quotaKey, noteCall, readSpend, LEDGER_TTL_SECONDS } from "@/lib/quota/ledger";

const now = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    incr: vi.fn(async (k: string) => { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
  };
}

describe("quota ledger", () => {
  it("окна считаются по UTC", () => {
    expect(monthWindow(now)).toBe("2026-11");
    expect(dayWindow(now)).toBe("2026-11-20");
  });

  it("ключ несёт службу, назначение и окно", () => {
    expect(quotaKey("coinpaprika", "bg", "2026-11")).toBe("quota:coinpaprika:bg:2026-11");
  });

  it("один вызов тикает оба окна", async () => {
    const r = fakeRedis();
    await noteCall(r, "coinpaprika", "bg", now);
    expect(r.store.get("quota:coinpaprika:bg:2026-11")).toBe(1);
    expect(r.store.get("quota:coinpaprika:bg:2026-11-20")).toBe(1);
    expect(r.expire).toHaveBeenCalledWith("quota:coinpaprika:bg:2026-11", LEDGER_TTL_SECONDS);
  });

  it("назначения считаются раздельно", async () => {
    const r = fakeRedis();
    await noteCall(r, "coinpaprika", "bg", now);
    await noteCall(r, "coinpaprika", "ui", now);
    await noteCall(r, "coinpaprika", "ui", now);
    const s = await readSpend(r, "coinpaprika", now);
    expect(s).toEqual({ bgMonth: 1, bgToday: 1, uiMonth: 2, uiToday: 2 });
  });

  it("сбой Redis вызов не роняет: счётчик дешевле запроса", async () => {
    const r = { incr: vi.fn(async () => { throw new Error("down"); }), expire: vi.fn(), get: vi.fn() };
    await expect(noteCall(r, "coingecko", "ui", now)).resolves.toBeUndefined();
  });

  it("нет Redis — остаток неизвестен, а не ноль", async () => {
    const r = { incr: vi.fn(), expire: vi.fn(), get: vi.fn(async () => { throw new Error("down"); }) };
    expect(await readSpend(r, "coingecko", now)).toBeNull();
  });

  it("пустой счётчик — это ноль, а не неизвестно", async () => {
    const r = fakeRedis();
    expect(await readSpend(r, "coinlore", now)).toEqual({ bgMonth: 0, bgToday: 0, uiMonth: 0, uiToday: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quota-ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Счёт наших вызовов к чужим службам. Считаем сами, потому что ни CoinGecko, ни
 * CoinPaprika счётчика не отдают: про исчерпанный запас мы узнаём из текста
 * отказа, то есть уже уперевшись в стену.
 *
 * Счёт увеличивается **внутри единственной двери** каждой службы (`cgGet`,
 * `cpGet`, шлюзы новых клиентов): другого пути наружу у службы нет, поэтому
 * забытый вызов мимо счёта не пройдёт. Считается каждая попытка, ушедшая в сеть,
 * включая повторы и отказы — чужая сторона считает их тоже (её счётчик 19 ноября
 * показал 20003 из 20000).
 */

import type { QuotaScope } from "./budget";

type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

/** Сорок суток: дольше самого длинного окна (месяц) с запасом на чтение отчёта. */
export const LEDGER_TTL_SECONDS = 40 * 24 * 3600;

export const monthWindow = (now: Date) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

export const dayWindow = (now: Date) => `${monthWindow(now)}-${String(now.getUTCDate()).padStart(2, "0")}`;

export const quotaKey = (service: string, scope: QuotaScope, window: string) =>
  `quota:${service}:${scope}:${window}`;

/**
 * Отметить ушедший в сеть вызов. Сбой записи глотается: счётчик дешевле самого
 * запроса (прецедент `recordRun` и `logCompanyAction`), а потеря видна в отчёте
 * тем, что число — нижняя граница.
 */
export async function noteCall(redis: RedisLike, service: string, scope: QuotaScope, now: Date): Promise<void> {
  try {
    for (const window of [monthWindow(now), dayWindow(now)]) {
      const key = quotaKey(service, scope, window);
      await redis.incr(key);
      await redis.expire(key, LEDGER_TTL_SECONDS);
    }
  } catch {
    // Пусто: см. разбор выше.
  }
}

export type QuotaSpend = { bgMonth: number; bgToday: number; uiMonth: number; uiToday: number };

const num = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Прочитать расход. null — счётчик недоступен: это «неизвестно», а не ноль. */
export async function readSpend(redis: RedisLike, service: string, now: Date): Promise<QuotaSpend | null> {
  const m = monthWindow(now);
  const d = dayWindow(now);
  try {
    const [bgMonth, bgToday, uiMonth, uiToday] = await Promise.all([
      redis.get(quotaKey(service, "bg", m)),
      redis.get(quotaKey(service, "bg", d)),
      redis.get(quotaKey(service, "ui", m)),
      redis.get(quotaKey(service, "ui", d)),
    ]);
    return { bgMonth: num(bgMonth), bgToday: num(bgToday), uiMonth: num(uiMonth), uiToday: num(uiToday) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quota-ledger.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quota/ledger.ts tests/quota-ledger.test.ts
git commit -m "feat(запас): счётчик вызовов в Redis, окна месяца и суток"
```

---

### Task 3: счёт внутри дверей CoinGecko и CoinPaprika

**Files:**
- Create: `src/lib/quota/count.ts`
- Modify: `src/lib/coingecko-http.ts` (`cgGet`, `cgGetUi`), `src/lib/coinpaprika-http.ts` (`cpGet`)
- Test: `tests/quota-count.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { setQuotaCounter, countCall, resetQuotaCounter } from "@/lib/quota/count";
import { cgGet, cgGetUi } from "@/lib/coingecko-http";
import { cpGet, resetCpQuotaBlock } from "@/lib/coinpaprika-http";
import { createRateGate } from "@/lib/rate-gate";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
const gate = () => createRateGate({ minIntervalMs: 0, sleep: async () => {}, now: () => 0 });

describe("счёт вызовов в дверях служб", () => {
  it("без установленного счётчика вызов проходит молча", async () => {
    resetQuotaCounter();
    await expect(countCall("coingecko", "bg")).resolves.toBeUndefined();
  });

  it("cgGet считает фоновый вызов", async () => {
    const seen: string[] = [];
    setQuotaCounter(async (s, scope) => void seen.push(`${s}:${scope}`));
    await cgGet("/ping", {}, { fetchImpl: vi.fn(async () => ok({})) as never, gate: gate() });
    expect(seen).toEqual(["coingecko:bg"]);
    resetQuotaCounter();
  });

  it("cgGetUi считает чтение посетителя", async () => {
    const seen: string[] = [];
    setQuotaCounter(async (s, scope) => void seen.push(`${s}:${scope}`));
    await cgGetUi("/ping", {}, { fetchImpl: vi.fn(async () => ok({})) as never, gate: gate() });
    expect(seen).toEqual(["coingecko:ui"]);
    resetQuotaCounter();
  });

  it("повтор после 429 считается отдельным вызовом: служба считает его тоже", async () => {
    const seen: string[] = [];
    setQuotaCounter(async (s, scope) => void seen.push(`${s}:${scope}`));
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1 ? { ok: false, status: 429, json: async () => ({}), text: async () => "slow down" } : ok({});
    });
    await cgGet("/ping", {}, { fetchImpl: fetchImpl as never, gate: gate(), sleep: async () => {}, retryDelaysMs: [1] });
    expect(seen).toHaveLength(2);
    resetQuotaCounter();
  });

  it("cpGet считает свой вызов своей службе", async () => {
    resetCpQuotaBlock();
    const seen: string[] = [];
    setQuotaCounter(async (s, scope) => void seen.push(`${s}:${scope}`));
    await cpGet("/exchanges", { fetchImpl: vi.fn(async () => ok([])) as never, gate: gate() });
    expect(seen).toEqual(["coinpaprika:bg"]);
    resetQuotaCounter();
  });

  it("запрос, не ушедший в сеть, не считается", async () => {
    const seen: string[] = [];
    setQuotaCounter(async (s, scope) => void seen.push(`${s}:${scope}`));
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 402, json: async () => ({}), text: async () => "has 20000 monthly requests limit, your requests rate is: 20003" }));
    await expect(cpGet("/exchanges", { fetchImpl: fetchImpl as never, gate: gate() })).rejects.toThrow();
    const first = seen.length;
    await expect(cpGet("/exchanges", { fetchImpl: fetchImpl as never, gate: gate() })).rejects.toThrow();
    expect(seen).toHaveLength(first); // второй запрос не ушёл: служба под запретом
    resetCpQuotaBlock();
    resetQuotaCounter();
  });

  it("сбой счётчика запрос не роняет", async () => {
    setQuotaCounter(async () => { throw new Error("redis down"); });
    const r = await cgGet("/ping", {}, { fetchImpl: vi.fn(async () => ok({ pong: 1 })) as never, gate: gate() });
    expect(r).toEqual({ pong: 1 });
    resetQuotaCounter();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quota-count.test.ts`
Expected: FAIL — `@/lib/quota/count` не найден.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/quota/count.ts`:

```ts
/**
 * Мост между дверями чужих служб и счётчиком.
 *
 * Шлюзы (`coingecko-http`, `coinpaprika-http`) нарочно не знают ни Redis, ни
 * Prisma: они проверяются тестом с подставным `fetch`, и тащить в них соединение
 * значило бы заводить его в каждом тесте. Поэтому счётчик **устанавливается**
 * один раз при старте процесса (`src/lib/quota/install.ts`), а двери зовут его
 * через этот мост. Не установлен — вызовы идут молча, и это законное состояние
 * (так в тестах и в скриптах).
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
```

Create `src/lib/quota/install.ts`:

```ts
/**
 * Установить счётчик вызовов на процесс. Зовётся один раз — из воркера и из
 * серверной части веба; второй вызов безвреден (ставится та же функция).
 */

import { redis } from "@/lib/redis";
import { noteCall } from "./ledger";
import { setQuotaCounter } from "./count";

export function installQuotaCounter(): void {
  setQuotaCounter(async (service, scope) => {
    await noteCall(redis, service, scope, new Date());
  });
}
```

In `src/lib/coingecko-http.ts` — import the bridge and count every network attempt. Add after the existing imports:

```ts
import { countCall } from "./quota/count";
```

Then inside `cgGet`, wrap the `once` body so the attempt is counted right before the request leaves (replace the existing `const once = async ...` opening line through the `const res = await fetchImpl(` call):

```ts
  const once = async (): Promise<unknown> => {
    // Считается каждая попытка, ушедшая в сеть: отвергнутый запрос чужая служба
    // считает тоже. Запись не ожидается — страница посетителя не должна ждать Redis.
    void countCall("coingecko", scope);
    const res = await fetchImpl(url, {
```

Add `scope` to `cgGet`'s signature by reading it from options with a default:

```ts
export type CgGetOptions = {
  fetchImpl?: JsonFetch;
  gate?: RateGate;
  sleep?: Sleep;
  jitter?: () => number;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  /** Чей это вызов: прогона или живой страницы. Считается раздельно. */
  scope?: QuotaScope;
};
```

and inside `cgGet`: `const scope = opts.scope ?? "bg";`. In `cgGetUi` pass `scope: opts.scope ?? "ui"` through to `cgGet`.
Import the type: `import type { QuotaScope } from "./quota/budget";`

In `src/lib/coinpaprika-http.ts` do the same: import `countCall` and `QuotaScope`, add `scope?: QuotaScope` to `CpGetOptions`, `const scope = opts.scope ?? "bg";`, and `void countCall("coinpaprika", scope);` as the first line of `once`.

In `src/lib/exchange-fresh.ts`, the on-demand page read must be counted as a visitor read — find the `fetchCoinPaprikaExchangeDetail` call and pass the scope through. In `src/lib/coinpaprika.ts`, give `fetchCoinPaprikaExchangeDetail` an options parameter:

```ts
export async function fetchCoinPaprikaExchangeDetail(
  id: string,
  opts: { timeoutMs?: number; scope?: QuotaScope } = {},
): Promise<CoinPaprikaExchangeDetail | null> {
```

passing `opts` straight into its `cpGet` calls, and in `exchange-fresh.ts` call it with `{ scope: "ui" }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quota-count.test.ts tests/outbound-timeouts.test.ts`
Expected: PASS.

- [ ] **Step 5: Install the counter in both processes**

In `worker/index.ts`, next to the other startup calls (before the cron block), add:

```ts
installQuotaCounter();
```

with `import { installQuotaCounter } from "@/lib/quota/install";` at the top. In the web process, add the same call to `src/lib/prisma.ts`'s module body? No — put it in `src/lib/quota/install.ts` consumers only: add `installQuotaCounter()` to `src/instrumentation.ts` if that file exists, otherwise create it:

```ts
// src/instrumentation.ts — Next.js зовёт `register()` один раз при старте сервера.
export async function register(): Promise<void> {
  const { installQuotaCounter } = await import("@/lib/quota/install");
  installQuotaCounter();
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/quota src/lib/coingecko-http.ts src/lib/coinpaprika-http.ts src/lib/coinpaprika.ts src/lib/exchange-fresh.ts src/instrumentation.ts worker/index.ts tests/quota-count.test.ts
git commit -m "feat(запас): счёт вызовов внутри дверей CoinGecko и CoinPaprika"
```

---

### Task 4: обход каталога берёт бюджет из остатка

**Files:**
- Modify: `worker/index.ts` (`runCoinPaprikaSync`)
- Create: `src/lib/quota/plan.ts`
- Test: `tests/quota-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { planRun } from "@/lib/quota/plan";
import { QUOTA_SERVICES } from "@/lib/quota/budget";

const now = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));

describe("planRun", () => {
  it("считает бюджет по прочитанному расходу", async () => {
    const redis = { get: vi.fn(async () => "0"), incr: vi.fn(), expire: vi.fn() };
    const p = await planRun(redis, QUOTA_SERVICES.coinpaprika, { runsPerDay: 24, fixedCostPerRun: 1, perRunCap: 25, now });
    expect(p.allowed).toBe(true);
    expect(p.calls).toBeGreaterThan(0);
  });

  it("нет счётчика — фон не идёт: он подождёт час, а запас месяц", async () => {
    const redis = { get: vi.fn(async () => { throw new Error("down"); }), incr: vi.fn(), expire: vi.fn() };
    const p = await planRun(redis, QUOTA_SERVICES.coinpaprika, { runsPerDay: 24, fixedCostPerRun: 1, perRunCap: 25, now });
    expect(p.allowed).toBe(false);
    expect(p.reason).toBe("no_ledger");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quota-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Что прогону можно прямо сейчас: прочитать расход и посчитать бюджет.
 *
 * Отдельно от `budget.ts` потому, что тот — чистый счёт без Redis, и таким он
 * проверяется тестом; и отдельно от `ledger.ts` потому, что тот не знает про
 * реестр служб.
 */

import { runBudget, type QuotaService, type RunBudgetReason } from "./budget";
import { readSpend } from "./ledger";

type RedisLike = Parameters<typeof readSpend>[0];

export type RunPlan = { allowed: boolean; calls: number; reason: RunBudgetReason | "no_ledger" };

export async function planRun(
  redis: RedisLike,
  service: QuotaService,
  opts: { runsPerDay: number; fixedCostPerRun: number; perRunCap: number; now?: Date },
): Promise<RunPlan> {
  const now = opts.now ?? new Date();
  const spend = await readSpend(redis, service.key, now);
  // Нет счётчика — остаток неизвестен, и фон не идёт. Посетителю мы в такой же
  // беде не отказываем (его запросов единицы), а прогон подождёт час: запас
  // считается месяцем. Это и есть броня живых страниц.
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
```

- [ ] **Step 4: Wire it into the sweep**

In `worker/index.ts`, inside `runCoinPaprikaSync`, replace the pinned `detailCallBudget: 11` with the computed plan and skip the run when it isn't allowed:

```ts
  const plan = await planRun(redis, QUOTA_SERVICES.coinpaprika, {
    runsPerDay: 24,
    fixedCostPerRun: 1, // запрос списка бирж уходит всегда
    perRunCap: 25,
  });
  if (!plan.allowed) {
    console.log(`[worker] coinpaprika sweep skipped: ${plan.reason}`);
    return;
  }
```

and pass `detailCallBudget: plan.calls` into `syncCoinPaprikaExchanges`. Replace the schedule comment's pinned arithmetic with a pointer to the budget module.

- [ ] **Step 5: Run the suite**

Run: `npx vitest run tests/quota-plan.test.ts && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quota/plan.ts tests/quota-plan.test.ts worker/index.ts
git commit -m "feat(запас): обход каталога бирж считает свой бюджет из остатка месяца"
```

---

### Task 5: клиент Coinlore и опознание бирж

**Files:**
- Create: `src/lib/coinlore.ts`
- Test: `tests/coinlore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  parseCoinloreExchanges,
  parseCoinlorePairs,
  matchExchange,
  COINLORE_ALIASES,
  PAIR_MAX_AGE_MS,
  CL_TIMEOUT_MS,
} from "@/lib/coinlore";

describe("coinlore", () => {
  it("разбирает список: ключ объекта — id службы", () => {
    const list = parseCoinloreExchanges({
      "5": { id: "5", name: "Binance", name_id: "binance", volume_usd: 1e9, active_pairs: 908, url: "https://binance.com", country: "Japan" },
      "739": { id: "739", name: "Websea", name_id: "websea", volume_usd: 1e7, active_pairs: 70, url: null, country: null },
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "5", nameId: "binance", activePairs: 908, volumeUsd: 1e9 });
  });

  it("строка не той формы выбрасывается, а не превращается в нули", () => {
    const list = parseCoinloreExchanges({ "1": { name: "Broken" }, "2": { id: "2", name: "Ok", name_id: "ok", volume_usd: 1, active_pairs: 1 } });
    expect(list.map((e) => e.nameId)).toEqual(["ok"]);
  });

  it("разбирает пары со временем сделки", () => {
    const pairs = parseCoinlorePairs({ pairs: [{ base: "BTC", quote: "USDT", volume: 10, price: 1, price_usd: 61000, time: 1795159715 }] });
    expect(pairs[0]).toMatchObject({ base: "BTC", quote: "USDT", priceUsd: 61000 });
    expect(pairs[0].tradedAt?.getTime()).toBe(1795159715 * 1000);
  });

  it("пара без базы или котировки не берётся", () => {
    expect(parseCoinlorePairs({ pairs: [{ base: "", quote: "USDT" }] })).toEqual([]);
  });

  it("опознание: точный ключ сильнее имени", () => {
    const ours = [{ id: "binance", name: "Binance" }, { id: "binance-us", name: "Binance US" }];
    expect(matchExchange({ nameId: "binance", name: "Binance" }, ours)).toBe("binance");
  });

  it("опознание по имени — только если наша строка одна", () => {
    const ours = [{ id: "gdax", name: "Coinbase Exchange" }, { id: "x", name: "Coinbase" }];
    expect(matchExchange({ nameId: "coinbase", name: "Coinbase" }, ours)).toBe("x");
  });

  it("неоднозначное имя — отказ, а не выбор первого", () => {
    const ours = [
      { id: "uniswap-v2", name: "Uniswap V2 (Ethereum)" },
      { id: "uniswap_v2", name: "Uniswap V2 (Ethereum)" },
    ];
    expect(matchExchange({ nameId: "uniswap", name: "Uniswap V2 (Ethereum)" }, ours)).toBeNull();
  });

  it("пришпиленный псевдоним закрывает известное расхождение", () => {
    expect(COINLORE_ALIASES.coinbase).toBe("gdax");
    const ours = [{ id: "gdax", name: "Coinbase Exchange" }];
    expect(matchExchange({ nameId: "coinbase", name: "Coinbase" }, ours)).toBe("gdax");
  });

  it("не нашлось — null, и зовущий считает это вслух", () => {
    expect(matchExchange({ nameId: "zke", name: "ZKE" }, [{ id: "binance", name: "Binance" }])).toBeNull();
  });

  it("у клиента есть срок запроса", () => {
    expect(CL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PAIR_MAX_AGE_MS).toBe(7 * 24 * 3600 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/coinlore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/coinlore.ts` with: zod schemas for the two payload shapes (`parseCoinloreExchanges`, `parseCoinlorePairs`), a normalizer (`[^a-z0-9]` stripped, lowercased), `COINLORE_ALIASES = { coinbase: "gdax" }`, `matchExchange` implementing «точное `name_id` → псевдоним → единственное совпадение по имени → null», a rate gate at one request per second (`createRateGate({ minIntervalMs: 1_000 })`), `CL_TIMEOUT_MS = 8_000`, retry on 429/5xx via `withRetry`, `void countCall("coinlore", scope)` inside the single request helper, and the two fetchers `fetchCoinloreExchanges()` / `fetchCoinlorePairs(id)`.

```ts
/**
 * Coinlore — бесплатный источник пар бирж: ключа нет, месячного запаса нет,
 * документированный предел — запрос в секунду. Живая проверка 20 ноября с нашего
 * адреса: список из 141 биржи одним запросом за 0,05 с, пары биржи — сто строк.
 *
 * Зачем он нужен. `ExchangeMarket` пуста у всех 581 бирж с начала проекта: её
 * наполняли подробности CoinPaprika, и именно они съедали месячный запас. То, за
 * чем мы туда ходим — число пар и сами пары, — Coinlore отдаёт даром.
 *
 * Чего он не делает: **новых бирж не заводит**. Каталог и так наполняют два
 * источника, и в базе уже лежат `gate` и `gateio`, `bybit_spot` и `bybit-spot` —
 * одна биржа двумя строками. Третий автор каталога умножил бы это.
 */
```

The pair age cap is `PAIR_MAX_AGE_MS = 7 * 24 * 3600 * 1000` — older means the exchange delisted it (the six-hour threshold of AV was for prices going into an index; a displayed pair is not that).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/coinlore.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coinlore.ts tests/coinlore.test.ts
git commit -m "feat(биржи): клиент Coinlore и строгое опознание бирж"
```

---

### Task 6: прогон Coinlore — число пар и строки ExchangeMarket

**Files:**
- Modify: `src/lib/sync/orchestrator.ts` (add `syncCoinloreExchanges`), `worker/index.ts` (job + cron `15 2 * * *`)
- Test: `tests/coinlore-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { syncCoinloreExchanges } from "@/lib/sync/orchestrator";

const ex = (over: Record<string, unknown> = {}) => ({
  id: "5", name: "Binance", nameId: "binance", volumeUsd: 1e9, activePairs: 908, url: null, country: null, ...over,
});

function prismaStub(rows: { id: string; name: string; volume24hUsd: number | null }[]) {
  const updates: Record<string, Record<string, unknown>> = {};
  const markets: Record<string, Record<string, unknown>> = {};
  return {
    updates, markets,
    exchange: {
      findMany: vi.fn(async () => rows),
      update: vi.fn(async ({ where, data }: never) => {
        updates[(where as { id: string }).id] = data as Record<string, unknown>;
      }),
    },
    exchangeMarket: {
      upsert: vi.fn(async ({ where, create }: never) => {
        markets[(where as { id: string }).id] = create as Record<string, unknown>;
      }),
    },
  } as never;
}

describe("syncCoinloreExchanges", () => {
  it("пишет число пар и пары сошедшейся биржи", async () => {
    const prisma = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [{ base: "BTC", quote: "USDT", volumeUsd: 10, priceUsd: 61000, tradedAt: new Date() }],
      pairBudget: 10,
      now: new Date(),
    });
    expect(r.matched).toBe(1);
    expect(r.unmatched).toBe(0);
    expect(r.marketsUpserted).toBe(1);
  });

  it("новой биржи не заводит и объём чужой строки не затирает", async () => {
    const prisma = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    await syncCoinloreExchanges({
      prisma,
      fetchExchanges: async () => [ex({ nameId: "zke", name: "ZKE", id: "999" }), ex()],
      fetchPairs: async () => [],
      pairBudget: 10,
      now: new Date(),
    });
    expect((prisma as never as { exchange: { update: { mock: { calls: unknown[] } } } }).exchange.update.mock.calls).toHaveLength(1);
    expect((prisma as never as { updates: Record<string, Record<string, unknown>> }).updates.binance.volume24hUsd).toBeUndefined();
  });

  it("объём пишется только там, где у нашей строки его нет", async () => {
    const prisma = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: null }]);
    await syncCoinloreExchanges({ prisma, fetchExchanges: async () => [ex()], fetchPairs: async () => [], pairBudget: 10, now: new Date() });
    expect((prisma as never as { updates: Record<string, Record<string, unknown>> }).updates.binance.volume24hUsd).toBe(1e9);
  });

  it("пара, не торговавшаяся неделю, не пишется", async () => {
    const prisma = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const r = await syncCoinloreExchanges({
      prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [{ base: "BTC", quote: "USDT", volumeUsd: 1, priceUsd: 1, tradedAt: old }],
      pairBudget: 10,
      now: new Date(),
    });
    expect(r.marketsUpserted).toBe(0);
    expect(r.pairsStale).toBe(1);
  });

  it("бюджет пар не перешагивается, и обойдённое называется", async () => {
    const prisma = prismaStub([
      { id: "binance", name: "Binance", volume24hUsd: 5 },
      { id: "kucoin", name: "KuCoin", volume24hUsd: 5 },
    ]);
    const fetchPairs = vi.fn(async () => []);
    const r = await syncCoinloreExchanges({
      prisma,
      fetchExchanges: async () => [ex(), ex({ id: "6", name: "KuCoin", nameId: "kucoin", volumeUsd: 1e8 })],
      fetchPairs,
      pairBudget: 1,
      now: new Date(),
    });
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(r.pairsSkippedByBudget).toBe(1);
  });

  it("сбой пар одной биржи прогон не роняет", async () => {
    const prisma = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => { throw new Error("502"); },
      pairBudget: 10,
      now: new Date(),
    });
    expect(r.matched).toBe(1);
    expect(r.pairFailures).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/coinlore-sync.test.ts`
Expected: FAIL — `syncCoinloreExchanges` не экспортируется.

- [ ] **Step 3: Write minimal implementation**

Add `syncCoinloreExchanges` to `src/lib/sync/orchestrator.ts`: read our catalog once (`exchange.findMany({ select: { id: true, name: true, volume24hUsd: true } })`), sort Coinlore list by volume desc, match with `matchExchange`, write `pairsCount` always and `volume24hUsd` only when ours is null, fetch pairs within `pairBudget` (most valuable first), skip pairs older than `PAIR_MAX_AGE_MS`, upsert `ExchangeMarket` with id `${exchangeId}:${base}:${quote}:spot`, set `marketsFetchedAt`, count `{ matched, unmatched, ambiguous, marketsUpserted, pairsStale, pairFailures, pairsSkippedByBudget }`.

- [ ] **Step 4: Wire the worker job**

In `worker/index.ts` add `runCoinloreSync()` that calls `planRun(redis, QUOTA_SERVICES.coinlore, { runsPerDay: 1, fixedCostPerRun: 1, perRunCap: 200 })`, passes `pairBudget: plan.calls`, logs the counters, and `recordRun(redis, "coinlore", "ok", new Date())`. Schedule it `cron.schedule("15 2 * * *", ...)` — before the BTC Map sync at 02:40, away from the hourly CoinPaprika sweep.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/coinlore-sync.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/orchestrator.ts worker/index.ts tests/coinlore-sync.test.ts
git commit -m "feat(биржи): прогон Coinlore наполняет пары и число пар бесплатно"
```

---

### Task 7: DefiLlama — запасная опора цены

**Files:**
- Create: `src/lib/defillama.ts`
- Modify: `src/lib/coin-card-market-seed.ts` (reference lookup)
- Test: `tests/defillama.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { parseLlamaPrices, llamaKey, pickReference, DL_TIMEOUT_MS, DL_MIN_CONFIDENCE } from "@/lib/defillama";

describe("defillama", () => {
  it("ключ монеты — её id у CoinGecko", () => {
    expect(llamaKey("moonbeam")).toBe("coingecko:moonbeam");
  });

  it("разбирает цену, тикер и доверие", () => {
    const m = parseLlamaPrices({ coins: { "coingecko:moonbeam": { price: 0.0065, symbol: "GLMR", timestamp: 1795160472, confidence: 0.999 } } });
    expect(m.get("moonbeam")).toMatchObject({ priceUsd: 0.0065, symbol: "GLMR", confidence: 0.999 });
  });

  it("запись без цены не берётся", () => {
    expect(parseLlamaPrices({ coins: { "coingecko:x": { symbol: "X" } } }).size).toBe(0);
  });

  it("опора берётся только при сошедшемся тикере", () => {
    const row = { priceUsd: 0.0065, symbol: "GLMR", confidence: 0.99, at: new Date() };
    expect(pickReference(row, "GLMR")).toBe(0.0065);
    expect(pickReference(row, "DOT")).toBeNull();
  });

  it("тикер сверяется без учёта регистра", () => {
    expect(pickReference({ priceUsd: 1, symbol: "glmr", confidence: 0.99, at: new Date() }, "GLMR")).toBe(1);
  });

  it("низкое доверие опорой не считается", () => {
    expect(pickReference({ priceUsd: 1, symbol: "GLMR", confidence: 0.2, at: new Date() }, "GLMR")).toBeNull();
    expect(DL_MIN_CONFIDENCE).toBe(0.9);
  });

  it("у клиента есть срок запроса", () => {
    expect(DL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/defillama.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/defillama.ts`: `DL_BASE = "https://coins.llama.fi"`, `DL_TIMEOUT_MS = 8_000`, `DL_MIN_CONFIDENCE = 0.9`, own rate gate (`minIntervalMs: 250`), `void countCall("defillama", "bg")` inside the request, `fetchLlamaPrices(ids: string[])` batching up to 50 ids per URL, `parseLlamaPrices`, `pickReference(row, expectedSymbol)` returning the price only when the symbol matches case-insensitively and confidence ≥ `DL_MIN_CONFIDENCE`.

Header comment must state why: опора сверки посева рынков (слайс X) берётся из
`CoinSnapshot`, то есть из запаса CoinGecko; у шести монет её не было вовсе
(`no_reference`), и уборка AU доплатила за неё ещё одним прогоном к CoinGecko.
DefiLlama отдаёт то же даром, с тикером для проверки и с полем доверия. Своей цены в
карточку она не пишет и в индекс не идёт.

- [ ] **Step 4: Use it as the fallback reference**

In `src/lib/coin-card-market-seed.ts`, where the reference price is read from the latest
`CoinSnapshot` and absence yields `no_reference`, add a second attempt via
`fetchLlamaPrices` for exactly the cards that came up empty (one batched request per run,
not per card), matching by the card's ticker. Keep the existing 25 % tolerance and the
48-hour staleness rule for the `CoinSnapshot` path untouched — DefiLlama is the fallback,
not a replacement.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/defillama.test.ts tests/coin-card-market-seed.test.ts tests/outbound-timeouts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/defillama.ts src/lib/coin-card-market-seed.ts tests/defillama.test.ts
git commit -m "feat(карточки): бесплатная опора цены от DefiLlama вместо лишнего вызова CoinGecko"
```

---

### Task 8: расход виден владельцу

**Files:**
- Modify: `src/lib/health-report.ts`
- Create: `scripts/quota-report.ts`
- Test: `tests/health-report.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

```ts
it("раздел запаса молчит, пока расход мал", () => {
  const lines = renderQuotaSection([
    { label: "CoinPaprika", verdict: { level: "quiet", spent: 900, budget: 16000, remaining: 15100, projected: 2700, exhaustsOn: null } },
  ]);
  expect(lines.join("\n")).toContain("запасы в норме");
});

it("раздел говорит число и дату стены", () => {
  const lines = renderQuotaSection([
    { label: "CoinPaprika", verdict: { level: "loud", spent: 9000, budget: 16000, remaining: 7000, projected: 27000, exhaustsOn: new Date(Date.UTC(2026, 10, 24)) } },
  ]);
  const text = lines.join("\n");
  expect(text).toContain("9000");
  expect(text).toContain("16000");
  expect(text).toContain("2026-11-24");
});

it("неизвестный расход называется неизвестным, а не нулём", () => {
  expect(renderQuotaSection([{ label: "CoinGecko", verdict: null }]).join("\n")).toContain("не записал ничего");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/health-report.test.ts`
Expected: FAIL — `renderQuotaSection` не экспортируется.

- [ ] **Step 3: Write minimal implementation**

Add `renderQuotaSection(rows)` to `src/lib/health-report.ts` and call it from the report
builder, reading `readSpend` + `budgetVerdict` per service in `QUOTA_SERVICES`. The report
itself makes **no outbound calls** — it reads our counters only.

- [ ] **Step 4: Hand tool**

Create `scripts/quota-report.ts` printing, per service: spent (bg/ui, month/day), our
budget, today's background allowance and what `runBudget` would hand the next sweep. Reads
only; writes nothing.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/health-report.test.ts && npx tsx scripts/quota-report.ts`
Expected: PASS; the script prints four services.

- [ ] **Step 6: Commit**

```bash
git add src/lib/health-report.ts scripts/quota-report.ts tests/health-report.test.ts
git commit -m "feat(отчёт): раздел запаса чужих служб и предупреждение до стены"
```

---

### Task 9: живой прогон, выкладка, память проекта

- [ ] **Step 1: Full suite and types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Build and restart both processes**

```bash
npm run build
env -u max_memory_restart pm2 restart trientes-web trientes-worker --update-env
pm2 save
```

(`src/lib` менялся — воркер обязан перезапуститься тоже: он пинает исходники lib при старте.)

- [ ] **Step 3: Live run — Coinlore**

```bash
npx tsx -e 'import("./src/lib/coinlore").then(async (m) => { const l = await m.fetchCoinloreExchanges(); console.log(l.length, l[0]); })'
```
Expected: ~141 строка, у первой есть `activePairs`.

- [ ] **Step 4: Live run — счётчик и бюджет**

```bash
npx tsx scripts/quota-report.ts
```
Expected: четыре службы; у CoinPaprika видно истраченное за месяц и число, которое получит следующий прогон.

- [ ] **Step 5: Live run — прогон Coinlore и проверка базы**

Trigger the job once by hand, then:

```bash
psql "$DATABASE_URL" -At -c 'select count(*) from "ExchangeMarket";' -c 'select count(*) from "Exchange" where "pairsCount" is not null;'
```
Expected: `ExchangeMarket` перестала быть пустой; у сошедшихся бирж появилось число пар.

- [ ] **Step 6: Live run — отчёт здоровья**

```bash
npx tsx scripts/health-report.ts
```
Expected: раздел «Запас чужих служб» присутствует и читается словами.

- [ ] **Step 7: Записать слайс в CLAUDE.md и запушить**

Add a `## Слайс BL` section in the project memory style: решения и их причины, живые числа,
что намеренно не сделано. Then:

```bash
git add -A && git commit -m "docs: слайс BL в CLAUDE.md — свой счёт вызовов, Coinlore, DefiLlama"
git push origin main
```
