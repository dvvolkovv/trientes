// Традиционные рынки через открытую службу графиков Yahoo Finance — без ключа,
// в том же духе, что остальные публичные источники проекта. Данные
// задержанные/индикативные, не биржевой поток.
//
// Почему не CNBC (прежний источник): с 16 ноября 2026, 23:08, quote.cnbc.com
// отвечает нашему адресу 403 на любой запрос — с браузерным UA, с referer и
// origin тоже. Табло 34 часа показывало прошлый снимок, и это видно глазом.
// Почему не Stooq и не CME: Stooq отдаёт 404 на запрос котировок, а cmegroup.com
// банит адрес за автоматический доступ (их же Data Terms of Use его запрещают).
// Почему не Twelve Data, хотя ключ лежит в `.env`: на тарифе Basic из десяти
// инструментов табло доступен один (XAU/USD), остальные требуют Pro.
//
// Yahoo прежде наш адрес тоже не пускал — это записано в спеке табло; после
// переезда на DigitalOcean он отвечает, и 18 ноября 2026 живым запросом
// проверены все десять инструментов.
//
// Цена одного запроса на инструмент (а не одного на всё табло, как у CNBC):
// у открытой службы графиков нет многосимвольного вида, а у многосимвольного
// `/v7/finance/quote` появилась проверка cookie+crumb. Десять запросов раз в
// двадцать минут дешевле, чем держать у себя подделку сеанса браузера.

export type MarketGroup = "index" | "future" | "metal";
export type MarketUnit = "usd" | "pts";

export type MarketInstrument = {
  /** Символ Yahoo: «^GSPC» для индекса, «CL=F» для ближнего фьючерса. */
  symbol: string;
  name: string; // display name (proper nouns) or i18n key handled at render
  group: MarketGroup;
  unit: MarketUnit;
};

export type MarketQuote = MarketInstrument & {
  date: string | null;
  time: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  last: number | null; // close
  changePct: number | null; // session move
  /**
   * Наш штамп: когда эта котировка у нас появилась (ISO, UTC). Ставит его
   * `syncMarkets`, а не разбор ответа, — чтобы разбор остался чистым.
   *
   * Зачем он при живых `date`/`time`: те принадлежат **рынку**, и у закрытого
   * индекса стоят на закрытии. По ним не отличить замолчавший источник от
   * выходного дня, а именно это и надо знать отчёту здоровья.
   */
  gotAt?: string;
};

export const MARKET_INSTRUMENTS: MarketInstrument[] = [
  { symbol: "^DJI", name: "Dow Jones", group: "index", unit: "pts" },
  { symbol: "^IXIC", name: "Nasdaq Composite", group: "index", unit: "pts" },
  { symbol: "^GSPC", name: "S&P 500", group: "index", unit: "pts" },
  { symbol: "ES=F", name: "S&P 500 Futures", group: "future", unit: "pts" },
  { symbol: "CL=F", name: "crude", group: "future", unit: "usd" },
  { symbol: "NG=F", name: "natgas", group: "future", unit: "usd" },
  { symbol: "GC=F", name: "gold", group: "metal", unit: "usd" },
  { symbol: "SI=F", name: "silver", group: "metal", unit: "usd" },
  { symbol: "PL=F", name: "platinum", group: "metal", unit: "usd" },
  { symbol: "PA=F", name: "palladium", group: "metal", unit: "usd" },
];

const BY_SYMBOL = new Map(MARKET_INSTRUMENTS.map((i) => [i.symbol, i]));

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Секунды эпохи → дата и время по UTC: табло подписывает штамп как UTC. */
function stamp(seconds: unknown): { date: string | null; time: string | null } {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return { date: null, time: null };
  }
  const iso = new Date(seconds * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

type YahooMeta = {
  symbol?: unknown;
  regularMarketTime?: unknown;
  regularMarketPrice?: unknown;
  regularMarketChangePercent?: unknown;
  regularMarketDayHigh?: unknown;
  regularMarketDayLow?: unknown;
  chartPreviousClose?: unknown;
};

/**
 * Тело ответа Yahoo по одному символу → котировка нашего инструмента.
 *
 * Чистая функция: разбор ответа — то место, где ломается источник данных, и
 * проверяться он должен тестом, а не живым запросом к чужой службе.
 *
 * `null` возвращается во всех сомнительных случаях (ошибка узла, незнакомый
 * символ, нет цены): карточка без цены на табло хуже отсутствующей, а прошлый
 * снимок за неё подставит `syncMarkets`.
 */
export function parseYahooChart(symbol: string, body: string): MarketQuote | null {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const chart = (raw as { chart?: { result?: unknown; error?: unknown } })?.chart;
  if (!chart || chart.error) return null;
  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result) return null;

  const meta = (result as { meta?: YahooMeta })?.meta;
  if (!meta) return null;
  // Узел обязан подтвердить, что отвечает про тот символ, о котором спросили:
  // иначе опечатка в реестре тихо повесила бы цену чужого инструмента.
  if (typeof meta.symbol === "string" && meta.symbol !== symbol) return null;

  const last = num(meta.regularMarketPrice);
  if (last === null) return null;

  // Открытие сессии лежит не в `meta`, а в свече дневного ряда.
  const candle = (result as { indicators?: { quote?: Array<{ open?: unknown }> } })?.indicators
    ?.quote?.[0];
  const open = num(Array.isArray(candle?.open) ? candle?.open[0] : candle?.open);

  const prevClose = num(meta.chartPreviousClose);
  const changePct =
    num(meta.regularMarketChangePercent) ??
    (prevClose !== null && prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : null);

  return {
    ...inst,
    ...stamp(meta.regularMarketTime),
    open,
    high: num(meta.regularMarketDayHigh),
    low: num(meta.regularMarketDayLow),
    last,
    changePct,
  };
}

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
// Служба отказывает голому клиенту; браузерный UA и Accept её устраивают.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Пауза между запросами: порог частоты служба не публикует, 1,2 с — осторожно. */
const REQUEST_GAP_MS = 1200;
/** Столько отказов по частоте подряд означает «бюджет окна исчерпан». */
const THROTTLE_GIVE_UP = 3;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export type MarketFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Что дал прогон: прошедшие котировки и то, о чём вообще спросили. */
export type MarketSweep = { quotes: MarketQuote[]; asked: string[] };

/**
 * Ответ на один запрос. «Срезано частотой» отделено от прочих неудач нарочно:
 * бюджет службы — свойство окна времени, а не инструмента, и после двух-трёх
 * таких ответов остальные запросы прогона — заведомые 429.
 */
type OneAnswer =
  | { quote: MarketQuote }
  | { throttled: true }
  | { failed: true };

async function fetchOne(
  inst: MarketInstrument,
  timeoutMs: number,
  fetchImpl: MarketFetchLike,
): Promise<OneAnswer> {
  const url = `${CHART_URL}/${encodeURIComponent(inst.symbol)}?range=1d&interval=1d`;
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (res.status === 429) return { throttled: true };
      if (!res.ok) return { failed: true };
      const q = parseYahooChart(inst.symbol, await res.text());
      return q ? { quote: q } : { failed: true };
    });
  } catch {
    return { failed: true };
  }
}

/**
 * Карта спросов: символ → время нашего запроса о нём (ISO, по UTC). Это **наш**
 * факт, а не рынка, и очередь строится только по нему.
 */
export type MarketAskedAt = Record<string, string | undefined>;

/**
 * Порядок обхода: о чём дольше всех не спрашивали, о том спрашиваем первым;
 * о чём не спрашивали ни разу — впереди всех.
 *
 * Почему по спросу, а не по штампу котировки (так было до 18 ноября): штамп
 * `regularMarketTime` принадлежит рынку, и у рынка, который стоит закрытым или
 * торгуется в другие часы, он не двигается. Такой инструмент навсегда оставался
 * самым ветхим, навсегда стоял первым — а ограничитель Yahoo режет именно
 * **начало** обхода, и первый запрос почти всегда получает 429. Голодание
 * закрепляло себя: платина и палладий не снялись ни разу за сутки, хотя живой
 * запрос их отдаёт. Спрос учитывается и когда он кончился отказом, поэтому
 * очередь двигается в любом случае и жертвенный слот достаётся всем по разу.
 */
export function marketFetchOrder(asked: MarketAskedAt): MarketInstrument[] {
  return [...MARKET_INSTRUMENTS].sort((a, b) => {
    const x = asked[a.symbol];
    const y = asked[b.symbol];
    if (x === y) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  });
}

/**
 * Самая ветхая карточка табло — наш штамп той котировки, которую дольше всех
 * не обновляли. Это и есть здоровье источника: он отдаёт одну-две карточки из
 * десяти за прогон, поэтому прогон без ответов — обычная работа, а не тишина,
 * а голодание одного инструмента видно только по нему самому.
 *
 * `null` означает «возраст неизвестен», а не «ноль»: так читается и пустое
 * табло, и снимок прежней формы без штампов (он самоизлечивается первым же
 * слиянием). Карточка без штампа рядом со штампованными ветхую не прячет.
 */
export function stalestQuoteAt(quotes: MarketQuote[]): Date | null {
  let oldest: number | null = null;
  for (const q of quotes) {
    const at = q.gotAt ? Date.parse(q.gotAt) : NaN;
    if (!Number.isFinite(at)) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest === null ? null : new Date(oldest);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Всё табло. Пустой массив означает «источник нам отказал», а не «рынков нет»:
 * по нему `syncMarkets` оставляет прошлый снимок, и табло ветшает, а не гаснет.
 *
 * Два решения, которые вытащил живой прогон 18 ноября.
 *
 * Запросы идут **по одному с паузой**: десять параллельных прошли на четырёх
 * инструментах из десяти, остальные получили 429. Служба режет частоту, и
 * догадываться о точном пороге бессмысленно — она его не публикует.
 *
 * Обход идёт **от самой ветхой карточки**: под ограничителем успевает пройти
 * только первая горстка запросов, и обход от начала списка означал бы, что
 * металлы в конце не обновляются никогда, а индексы в начале — каждый раз.
 * Порядок задаёт `marketFetchOrder` по прошлому снимку, который и подставляет
 * `syncMarkets` за не прошедшие карточки — со своим штампом времени у каждой.
 *
 * Обход **прекращается после трёх подряд отказов по частоте**. Замер 18 ноября:
 * бюджет службы — около одной котировки в полминуты, и от паузы между
 * запросами он не зависит (с паузой 5 с прошла одна из шести, с паузой 1,2 с —
 * одна-две из десяти). Значит после трёх 429 остальные запросы прогона —
 * заведомые 429, и слать их означает только давить на чужую службу.
 *
 * Прогон возвращает **и то, о чём спросил** — вместе с теми, кому отказали по
 * частоте: по этому списку двигается очередь следующего прогона.
 */
export async function fetchMarkets(
  order: MarketInstrument[] = MARKET_INSTRUMENTS,
  opts: { timeoutMs?: number; gapMs?: number; fetchImpl?: MarketFetchLike } = {},
): Promise<MarketSweep> {
  const { timeoutMs = 10000, gapMs = REQUEST_GAP_MS, fetchImpl = fetch } = opts;
  const quotes: MarketQuote[] = [];
  const asked: string[] = [];
  let throttled = 0;
  for (const [i, inst] of order.entries()) {
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    const a = await fetchOne(inst, timeoutMs, fetchImpl);
    asked.push(inst.symbol);
    if ("quote" in a) {
      quotes.push(a.quote);
      throttled = 0;
      continue;
    }
    if ("throttled" in a && ++throttled >= THROTTLE_GIVE_UP) break;
  }
  return { quotes, asked };
}
