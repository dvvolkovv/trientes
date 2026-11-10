/**
 * Чтение точек графика монеты: свежий кэш → сеть → **запасная копия**.
 *
 * Зачем запасная копия. Лимит CoinGecko общий у сайта и воркера (считается по
 * IP), и в минуту, когда он исчерпан, маршрут `/api/coins/[id]/history`
 * отдавал 502, то есть посетитель видел пустой график. Живая проверка
 * 10 ноября 2026: три запроса подряд — 502, затем 200, затем 200 из кэша;
 * данные были в порядке, не хватило только права спросить в эту минуту.
 *
 * Поэтому на каждый успешный ответ пишутся две копии: свежая (TTL таймфрейма,
 * как было) и запасная на неделю. Сорвалось чтение — отдаём запасную и
 * помечаем ответ `x-cache: stale`. Старые точки графика за неделю — это не
 * ложь о цене: последняя точка просто не дотягивает до сейчас, а шкала
 * времени у данных своя.
 *
 * Пустой ответ сети запасную копию не затирает: ряд без точек — это не история
 * монеты, а признак того, что отвечал не тот, кого спрашивали.
 */

import type { ChartPoint } from "@/lib/coingecko";
import { HISTORY_KEY, HISTORY_TTL } from "@/lib/sync/keys";

export const HISTORY_STALE_KEY = (id: string, timeframe: string) =>
  `${HISTORY_KEY(id, timeframe)}:stale`;

/** Неделя: столько держим последнее хорошее чтение на случай отказа сети. */
export const HISTORY_STALE_TTL = 7 * 24 * 60 * 60;

export type ChartHistoryIo = {
  fetchChart: (id: string, timeframe: string) => Promise<ChartPoint[]>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<unknown>;
};

export type ChartHistoryResult = {
  points: ChartPoint[];
  cache: "hit" | "miss" | "stale";
};

async function readPoints(io: ChartHistoryIo, key: string): Promise<ChartPoint[] | null> {
  let raw: string | null;
  try {
    raw = await io.get(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChartPoint[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function readChartHistory(
  id: string,
  timeframe: string,
  io: ChartHistoryIo,
): Promise<ChartHistoryResult> {
  const fresh = await readPoints(io, HISTORY_KEY(id, timeframe));
  if (fresh) return { points: fresh, cache: "hit" };

  let points: ChartPoint[];
  try {
    points = await io.fetchChart(id, timeframe);
  } catch (err) {
    const stale = await readPoints(io, HISTORY_STALE_KEY(id, timeframe));
    if (stale) return { points: stale, cache: "stale" };
    throw err;
  }

  if (points.length === 0) {
    const stale = await readPoints(io, HISTORY_STALE_KEY(id, timeframe));
    if (stale) return { points: stale, cache: "stale" };
    return { points, cache: "miss" };
  }

  const body = JSON.stringify(points);
  try {
    await io.set(HISTORY_KEY(id, timeframe), body, HISTORY_TTL[timeframe] ?? 60 * 60);
    await io.set(HISTORY_STALE_KEY(id, timeframe), body, HISTORY_STALE_TTL);
  } catch {
    // Кэш — помощник, а не условие ответа.
  }
  return { points, cache: "miss" };
}
