/**
 * Наш собственный факт о прогоне: когда он в последний раз прошёл и когда в
 * последний раз упёрся в исчерпанный запас чужой службы.
 *
 * Зачем он нужен. Ночной отчёт мерит прогоны по возрасту того, что каждый
 * пишет, — своего журнала запусков в проекте нет. Для обхода каталога бирж
 * такого следа не существует: строки `Exchange` трогает и прогон CoinGecko, а
 * `marketsFetchedAt` у всех 581 бирж пусто (подробности CoinPaprika рынков так
 * и не отдали). Поэтому замолчавшую CoinPaprika отчёт не видел вовсе — 19
 * ноября запас месяца кончился, веб падал по памяти, и нашлось это глазом
 * (уборка BH), а не отчётом.
 *
 * Исчерпанный запас — **состояние службы, а не сбой прогона**: до обновления
 * запаса звонить некуда, и будить человека каждую ночь одной и той же строкой
 * «прогон замолчал» значит приучить его отчёт не читать (правило слайса AA).
 * Поэтому два часа хранятся отдельно: по первому мерится свежесть, второй
 * объясняет причину тишины.
 *
 * Запись живёт в Redis, а не в базе: таблицы запусков в проекте нет, и заводить
 * её ради одного прогона — больше, чем стоит сама проверка. Сбой записи работу
 * не роняет (прецедент `logCompanyAction`): факт о прогоне дешевле прогона.
 */

export type RunOutcome = "ok" | "quota";

export interface RunState {
  /** Последний прогон, который прошёл до конца. */
  okAt: Date | null;
  /** Последний отказ чужой службы по исчерпанному запасу. */
  quotaAt: Date | null;
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

/**
 * Месяц: дольше любого разумного молчания и дольше запаса, который считается
 * месяцем. Пропала запись — отчёт скажет «не записал ничего», и это правда.
 */
export const RUN_STATE_TTL_SECONDS = 30 * 24 * 3600;

export const runStateKey = (name: string) => `run:${name}`;

/** Имя прогона — одно на запись и на чтение: вторая копия строки разошлась бы с первой. */
export const RUN_COINPAPRIKA = "coinpaprika";

const asDate = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Прочитать факт о прогоне. null — прогон не записал ничего или запись негодна. */
export async function readRunState(redis: RedisLike, name: string): Promise<RunState | null> {
  let raw: string | null = null;
  try {
    raw = await redis.get(runStateKey(name));
  } catch {
    return null; // нет Redis — нет факта; отчёт скажет это прямо
  }
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const okAt = asDate(j.okAt);
    const quotaAt = asDate(j.quotaAt);
    if (!okAt && !quotaAt) return null;
    return { okAt, quotaAt };
  } catch {
    return null;
  }
}

/** Записать исход прогона, не затирая другой час: они говорят о разном. */
export async function recordRun(redis: RedisLike, name: string, outcome: RunOutcome, now: Date): Promise<void> {
  try {
    const prev = await readRunState(redis, name);
    const next: RunState = {
      okAt: outcome === "ok" ? now : prev?.okAt ?? null,
      quotaAt: outcome === "quota" ? now : prev?.quotaAt ?? null,
    };
    await redis.set(
      runStateKey(name),
      JSON.stringify({ okAt: next.okAt?.toISOString() ?? null, quotaAt: next.quotaAt?.toISOString() ?? null }),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
  } catch {
    // Факт о прогоне дешевле самого прогона: его потеря видна в отчёте строкой
    // «не записал ничего», а брошенное отсюда исключение сорвало бы обход.
  }
}

/** Служба отвечает «запас исчерпан»: последним был отказ, а не удачный прогон. */
export function quotaBlocked(state: RunState | null): boolean {
  if (!state?.quotaAt) return false;
  return !state.okAt || state.quotaAt.getTime() > state.okAt.getTime();
}
