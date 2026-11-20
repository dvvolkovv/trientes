/**
 * Счёт наших вызовов к чужим службам. Считаем сами, потому что ни CoinGecko, ни
 * CoinPaprika счётчика не отдают: про исчерпанный запас мы узнаём из текста
 * отказа, то есть уже уперевшись в стену (живой случай 19 ноября).
 *
 * Счёт увеличивается **внутри единственной двери** каждой службы (`cgGet`,
 * `cpGet`, шлюзы новых клиентов): другого пути наружу у службы нет, поэтому
 * забытый вызов мимо счёта не пройдёт — то же правило, которым BE дал калитке
 * `canWrite` обязательный раздел.
 *
 * Считается каждая попытка, **ушедшая в сеть**, включая повторы и отказы: чужая
 * сторона считает их тоже — её счётчик 19 ноября показал 20003 из 20000, то есть
 * отвергнутые запросы запас тратят.
 *
 * Запись живёт в Redis, а не в базе: таблицы под счёт в проекте нет, и заводить
 * её ради четырёх чисел дороже самой проверки (тот же разбор, что у `run-state`).
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
 * запроса (прецедент `recordRun` и `logCompanyAction`), а потеря видна в том, что
 * наше число — нижняя граница истраченного, и запас взят ниже настоящего.
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
