/**
 * Свечи нашего обмена: ряд, который ведёт служба заявок сети Trientes.
 *
 * Слайс AB дал карточке Taler цену, но не ряд: наш индекс пишет по точке в час,
 * и график из одной точки не рисуется. У обмена ряд уже есть — тот самый, что
 * видно на `/exchange` при выборе TAL, — и отдаётся он обычным HTTP
 * (`/exchange-api/candles`, прокси nginx на службу заявок).
 *
 * Берём его как есть и не пересчитываем: автор значения один — служба, которая
 * его ведёт. Что это за ряд, карточка говорит прямо: цена — котировка
 * маркетмейкера обмена, объём — только сделки клиентов. Это не сводный рынок
 * биржи, и выдавать его за сводный нельзя.
 */

/** Какие шаги умеет служба. Остальное она отвергает `bad_interval`. */
export const DEX_CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type DexCandleInterval = (typeof DEX_CANDLE_INTERVALS)[number];

export const DEX_CANDLES_API = "/exchange-api/candles";

export type DexCandle = {
  /** Начало свечи, секунды Unix. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Объём сделок клиентов в базовой монете; ноль — сделок не было. */
  volume: number;
};

export type DexCandles = {
  symbol: string;
  interval: DexCandleInterval;
  /** Блок, на котором служба сняла ряд: по нему число можно повторить. */
  block: number | null;
  candles: DexCandle[];
};

export type DexPair = { key: string; base: string; quote: string };

const SYMBOL = /^[A-Z0-9]{2,12}$/;

/** Пара рынка в карточке записана как `TAL/USDT`, в пути службы — `TAL-USDT`. */
export function dexPairKey(pair: string | null | undefined): string | null {
  if (typeof pair !== "string") return null;
  // Ровно две части: ключ уходит в путь запроса, и «почти пара» туда не идёт.
  const parts = pair.trim().toUpperCase().split("/");
  if (parts.length !== 2) return null;
  const [base, quote] = parts;
  if (!SYMBOL.test(base) || !SYMBOL.test(quote)) return null;
  return `${base}-${quote}`;
}

export function isDexInterval(value: unknown): value is DexCandleInterval {
  return typeof value === "string" && (DEX_CANDLE_INTERVALS as readonly string[]).includes(value);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Список пар, у которых ряд есть. Свечи ведёт не каждая пара обмена: у карточек
 * Bitcoin, Ethereum и Polkadot рынок нашего обмена тоже записан, а ряда у них
 * нет — и спрашивать его у службы незачем.
 */
export function parseDexPairs(raw: unknown): DexPair[] {
  if (!isObject(raw) || !Array.isArray(raw.pairs)) return [];
  const out: DexPair[] = [];
  for (const row of raw.pairs) {
    if (!isObject(row)) continue;
    const { key, base, quote } = row;
    if (typeof key !== "string" || typeof base !== "string" || typeof quote !== "string") continue;
    if (!SYMBOL.test(base) || !SYMBOL.test(quote) || key !== `${base}-${quote}`) continue;
    out.push({ key, base, quote });
  }
  return out;
}

/**
 * Разбор ответа службы. Свеча с нулём или отрицательной ценой, перепутанные
 * верх и низ, неупорядоченное время — повод отказаться от ряда целиком, а не
 * нарисовать то, что разобралось: кривой график читается как настоящий.
 */
export function parseDexCandles(raw: unknown, expect: { pair: DexPair; interval: string }): DexCandles | null {
  if (!isObject(raw) || raw.source !== "trientes") return null;
  if (raw.symbol !== `${expect.pair.base}/${expect.pair.quote}`) return null;
  if (raw.interval !== expect.interval || !isDexInterval(raw.interval)) return null;
  if (!Array.isArray(raw.candles)) return null;

  const candles: DexCandle[] = [];
  for (const row of raw.candles) {
    if (!isObject(row)) return null;
    const time = finite(row.time);
    const open = finite(row.open);
    const high = finite(row.high);
    const low = finite(row.low);
    const close = finite(row.close);
    const volume = finite(row.volume);
    if (time == null || open == null || high == null || low == null || close == null || volume == null) {
      return null;
    }
    if (!Number.isInteger(time) || time <= 0) return null;
    if (open <= 0 || close <= 0 || low <= 0 || volume < 0) return null;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
    const prev = candles[candles.length - 1];
    if (prev && time <= prev.time) return null;
    candles.push({ time, open, high, low, close, volume });
  }

  const block = isObject(raw.asOf) ? finite(raw.asOf.block) : null;
  return { symbol: raw.symbol, interval: raw.interval, block, candles };
}
