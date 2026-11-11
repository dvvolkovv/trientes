/**
 * Чтение нашего собственного обмена — пятая семья сетей в карточках монет.
 *
 * Обмен живёт не в сети монеты, а в отдельной сети Trientes (узлы rpc1/rpc2):
 * там палета swap держит реестр тикеров, монет и пар, а рантайм отвечает на
 * `SwapApi`. Читаем обычным HTTP JSON-RPC через `state_call`, как слайсы S и T
 * читают Substrate: декодера метаданных в проекте нет и не заводится.
 *
 * Что именно сеть считает ценой. `SwapApi_quote(from, to, amount)` возвращает
 * пять чисел: цену пары (FixedU128, целая котировка за целую базу), валовую
 * выдачу, наценку, комиссию сети и чистую выдачу. Цена — до вычетов, и в ней
 * нет постоянной комиссии сети, поэтому на малых суммах она не врёт. Сверено
 * живым прогоном 2026-11-11: пара BTC/USDT дала 74 419 при 74 346 у фида.
 *
 * Два направления дают разные числа — это спрос и предложение маркет-мейкера,
 * а не сбой: цену берём серединой и отказываемся, когда спред шире разумного.
 * Объём торгов сеть не публикует вовсе — ни за сутки, ни за всё время; поле
 * объёма остаётся пустым, а не нулевым.
 */

export const TRIENTES_DEX_RPC = process.env.TRIENTES_DEX_RPC ?? "https://rpc2.trientes.com";

/** Шире этого расхождения двух направлений цена не считается ценой. */
export const MAX_SPREAD_PCT = 10;
/**
 * Размеры пробной заявки, целых единиц, в порядке попытки. У каждой пары свои
 * границы заявки, и одна целая единица в них не всегда попадает: одна USDT
 * меньше минимума заявки в эфире, десять TAL больше максимума. Цена от размера
 * не зависит — сеть отдаёт её тем же числом на любой принятой сумме, — поэтому
 * берём первый принятый размер, а не средний.
 */
export const PROBE_WHOLE = [1, 10, 100, 0.1, 0.01, 1000, 0.001] as const;

export type DexReadError =
  | "rpc_unreachable"
  | "rpc_error"
  | "registry_unreadable"
  | "pair_not_found"
  | "quote_refused"
  | "spread_too_wide";

export type DexTicker = {
  id: number;
  symbol: string;
  decimals: number;
  open: boolean;
  markupPpm: number;
};

export type DexCoin = {
  id: number;
  ticker: number;
  symbol: string;
  decimals: number;
  open: boolean;
};

export type DexPair = { base: number; quote: number };

export type DexRegistry = {
  tickers: DexTicker[];
  coins: DexCoin[];
  pairs: DexPair[];
};

/** Пять чисел одной котировки, в наименьших единицах монет. */
export type DexQuote = {
  /** Цена пары: целая котировка за целую базу, FixedU128 (внутреннее × 10^18). */
  price: bigint;
  gross: bigint;
  markupFee: bigint;
  networkFee: bigint;
  net: bigint;
};

/* ─── разбор SCALE ───────────────────────────────────────────────────────── */

export function hexToBytes(hex: string): number[] {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error("odd hex");
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

/** Компакт одного байта: длины реестров и имён у этой сети короткие. */
function compactSmall(b: number[], at: number): number {
  if ((b[at] & 0b11) !== 0) throw new Error("compact too long");
  return b[at] >> 2;
}

function u32le(b: number[], at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function u128le(b: number[], at: number): bigint {
  let v = BigInt(0);
  for (let i = 15; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[at + i] ?? 0);
  return v;
}

/** `SwapApi_tickers`: id, символ, знаки, открыт, наценка в ppm. */
export function decodeTickers(hex: string): DexTicker[] {
  const b = hexToBytes(hex);
  const n = compactSmall(b, 0);
  let i = 1;
  const out: DexTicker[] = [];
  for (let k = 0; k < n; k++) {
    const id = b[i++];
    const len = compactSmall(b, i++);
    const symbol = String.fromCharCode(...b.slice(i, i + len));
    i += len;
    const decimals = b[i++];
    const open = b[i++] === 1;
    const markupPpm = u32le(b, i);
    i += 4;
    if (!symbol || !/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error(`ticker ${id}: bad symbol`);
    out.push({ id, symbol, decimals, open, markupPpm });
  }
  if (i !== b.length) throw new Error("tickers: trailing bytes");
  return out;
}

/** `SwapApi_pairs`: пары тикеров в той ориентации, в которой их котирует сеть. */
export function decodePairs(hex: string): DexPair[] {
  const b = hexToBytes(hex);
  const n = compactSmall(b, 0);
  if (b.length !== 1 + n * 2) throw new Error("pairs: unexpected length");
  const out: DexPair[] = [];
  for (let k = 0; k < n; k++) out.push({ base: b[1 + k * 2], quote: b[2 + k * 2] });
  return out;
}

/**
 * `SwapApi_coins`: монета на сети. Запись переменной длины — мост, его сеть и
 * адрес токена пишутся по-разному у каждой семьи, — а декодера метаданных у нас
 * нет. Поэтому ищем не начало записи, а её хвост: тройку «тикер, знаки, открыт»
 * и два числа границ заявки за ней. Тройка принимается, только когда тикер есть
 * в реестре, а знаки совпадают с его знаками, и следом начинается запись со
 * следующим номером. Не сошлось — `registry_unreadable`, и ни одного числа.
 */
export function decodeCoins(hex: string, tickers: DexTicker[]): DexCoin[] {
  const b = hexToBytes(hex);
  const byId = new Map(tickers.map((t) => [t.id, t]));
  const count = compactSmall(b, 0);
  const out: DexCoin[] = [];
  let p = 1;
  for (let k = 0; k < count; k++) {
    const id = b[p];
    let tail = -1;
    for (let q = p + 5; q + 35 <= b.length; q++) {
      const t = byId.get(b[q]);
      if (!t || b[q + 1] !== t.decimals || b[q + 2] > 1) continue;
      const end = q + 3 + 32;
      const last = k + 1 === count;
      if (last ? end === b.length : b[end] === k + 1) {
        tail = q;
        break;
      }
    }
    if (tail < 0) throw new Error(`coin ${k}: tail not found`);
    const t = byId.get(b[tail]);
    if (!t) throw new Error(`coin ${k}: unknown ticker`);
    out.push({ id, ticker: t.id, symbol: t.symbol, decimals: b[tail + 1], open: b[tail + 2] === 1 });
    p = tail + 35;
  }
  if (p !== b.length) throw new Error("coins: trailing bytes");
  return out;
}

/** `SwapApi_quote`: Ok — пять чисел, Err — вариант отказа рантайма. */
export function decodeQuote(hex: string): DexQuote | { error: "quote_refused"; variant: number } {
  const b = hexToBytes(hex);
  if (b[0] === 1) return { error: "quote_refused", variant: b[1] ?? -1 };
  if (b[0] !== 0 || b.length !== 1 + 5 * 16) throw new Error("quote: unexpected shape");
  return {
    price: u128le(b, 1),
    gross: u128le(b, 17),
    markupFee: u128le(b, 33),
    networkFee: u128le(b, 49),
    net: u128le(b, 65),
  };
}

/* ─── сеть ───────────────────────────────────────────────────────────────── */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function stateCall(
  method: string,
  argsHex: string,
  fetchImpl: FetchLike,
): Promise<{ hex: string } | { error: DexReadError }> {
  let res: Response;
  try {
    res = await fetchImpl(TRIENTES_DEX_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "state_call", params: [method, argsHex] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: "rpc_unreachable" };
  }
  // 4xx — ответ узла и он повторится, 5xx и 429 — связь: та же классификация,
  // что у семьи Bitcoin (слайс Y).
  if (!res.ok) return { error: res.status >= 500 || res.status === 429 ? "rpc_unreachable" : "rpc_error" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { error: "rpc_error" };
  }
  const r = body as { result?: unknown; error?: unknown };
  if (r.error || typeof r.result !== "string") return { error: "rpc_error" };
  return { hex: r.result };
}

/** Реестр обмена: тикеры, монеты и пары одним чтением. */
export async function readSwapRegistry(
  fetchImpl: FetchLike = fetch,
): Promise<DexRegistry | { error: DexReadError }> {
  const [t, c, p] = await Promise.all([
    stateCall("SwapApi_tickers", "0x", fetchImpl),
    stateCall("SwapApi_coins", "0x", fetchImpl),
    stateCall("SwapApi_pairs", "0x", fetchImpl),
  ]);
  for (const r of [t, c, p]) if ("error" in r) return { error: r.error };
  try {
    const tickers = decodeTickers((t as { hex: string }).hex);
    return {
      tickers,
      coins: decodeCoins((c as { hex: string }).hex, tickers),
      pairs: decodePairs((p as { hex: string }).hex),
    };
  } catch {
    return { error: "registry_unreadable" };
  }
}

function argsHex(from: number, to: number, amount: bigint): string {
  let h = "0x" + from.toString(16).padStart(2, "0") + to.toString(16).padStart(2, "0");
  for (let i = 0; i < 16; i++) h += Number((amount >> BigInt(8 * i)) & BigInt(0xff)).toString(16).padStart(2, "0");
  return h;
}

export async function quoteCoins(
  from: number,
  to: number,
  amount: bigint,
  fetchImpl: FetchLike = fetch,
): Promise<DexQuote | { error: DexReadError }> {
  const r = await stateCall("SwapApi_quote", argsHex(from, to, amount), fetchImpl);
  if ("error" in r) return { error: r.error };
  try {
    const q = decodeQuote(r.hex);
    if ("error" in q) return { error: "quote_refused" };
    return q;
  } catch {
    return { error: "registry_unreadable" };
  }
}

/* ─── цена пары ──────────────────────────────────────────────────────────── */

/**
 * Котировка на первом размере заявки, который сеть приняла. Отказ рантайма по
 * границам заявки — не сбой чтения, а «спроси другую сумму»; настоящий сбой
 * связи прекращает перебор сразу, чтобы не бить по узлу семь раз подряд.
 */
async function quoteProbe(
  from: DexCoin,
  to: DexCoin,
  fetchImpl: FetchLike,
): Promise<DexQuote | { error: DexReadError }> {
  let last: DexReadError = "quote_refused";
  for (const whole of PROBE_WHOLE) {
    const amount = BigInt(Math.round(whole * 10 ** from.decimals));
    if (amount <= BigInt(0)) continue;
    const q = await quoteCoins(from.id, to.id, amount, fetchImpl);
    if (!("error" in q)) return q;
    if (q.error !== "quote_refused") return q;
    last = q.error;
  }
  return { error: last };
}

export type DexPrice = {
  /** Пара так, как её ориентирует сеть: «TAL/USDT». */
  pair: string;
  base: string;
  quote: string;
  /** Середина спроса и предложения, целая котировка за целую базу. */
  price: number;
  /** Что дают за базу и что за неё просят — два направления одной пары. */
  bid: number;
  ask: number;
  spreadPct: number;
  /** Наценка пары, доли процента: сумма наценок двух тикеров. */
  markupPct: number;
};

const fixed = (v: bigint): number => Number(v) / 1e18;

/**
 * Цена пары base/quote по двум направлениям. Отдельная функция, потому что
 * одного направления мало: маркет-мейкер держит разные спрос и предложение, и
 * взять одно за «цену» значило бы показать его сторону сделки.
 */
export async function readPairPrice(
  registry: DexRegistry,
  baseSymbol: string,
  quoteSymbol: string,
  fetchImpl: FetchLike = fetch,
): Promise<DexPrice | { error: DexReadError }> {
  const base = registry.coins.find((c) => c.symbol === baseSymbol.toUpperCase() && c.open);
  const quote = registry.coins.find((c) => c.symbol === quoteSymbol.toUpperCase() && c.open);
  if (!base || !quote) return { error: "pair_not_found" };
  const pair = registry.pairs.find(
    (p) =>
      (p.base === base.ticker && p.quote === quote.ticker) ||
      (p.base === quote.ticker && p.quote === base.ticker),
  );
  if (!pair) return { error: "pair_not_found" };

  const sell = await quoteProbe(base, quote, fetchImpl);
  if ("error" in sell) return { error: sell.error };
  const buy = await quoteProbe(quote, base, fetchImpl);
  if ("error" in buy) return { error: buy.error };

  // Оба направления сеть называет ценой ПАРЫ, а не направления сделки: число
  // в обоих случаях — котировка за базу. Поэтому их можно сравнивать прямо.
  const bid = fixed(sell.price);
  const ask = fixed(buy.price);
  if (!(bid > 0) || !(ask > 0)) return { error: "quote_refused" };
  const price = (bid + ask) / 2;
  const spreadPct = (Math.abs(ask - bid) / price) * 100;
  if (spreadPct > MAX_SPREAD_PCT) return { error: "spread_too_wide" };

  const markup = (t: number) => registry.tickers.find((x) => x.id === t)?.markupPpm ?? 0;
  return {
    pair: `${base.symbol}/${quote.symbol}`,
    base: base.symbol,
    quote: quote.symbol,
    price,
    bid,
    ask,
    spreadPct,
    markupPct: (markup(base.ticker) + markup(quote.ticker)) / 10_000,
  };
}
