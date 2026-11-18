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

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(inst: MarketInstrument, timeoutMs: number): Promise<MarketQuote | null> {
  const url = `${CHART_URL}/${encodeURIComponent(inst.symbol)}?range=1d&interval=1d`;
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (!res.ok) return null;
      return parseYahooChart(inst.symbol, await res.text());
    });
  } catch {
    return null;
  }
}

/**
 * С какого инструмента начинать обход. Живет в модуле, а не в Redis: порядок
 * обхода — не данные, и после перезапуска воркера табло просто обновится в
 * другом порядке.
 */
let rotation = 0;

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
 * Обход начинается **со сдвигом**: под ограничителем успевает пройти только
 * первая горстка запросов, и обход от начала списка означал бы, что металлы в
 * конце не обновляются никогда, а индексы в начале — каждый раз. Со сдвигом
 * ветшают разные карточки, и прошлый снимок за них подставляет `syncMarkets`,
 * у которого карточка несёт свой штамп времени.
 */
export async function fetchMarkets(timeoutMs = 10000): Promise<MarketQuote[]> {
  const n = MARKET_INSTRUMENTS.length;
  const start = rotation % n;
  rotation = (rotation + 1) % n;

  const out: MarketQuote[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    const inst = MARKET_INSTRUMENTS[(start + i) % n];
    const q = await fetchOne(inst, timeoutMs);
    if (q) out.push(q);
  }
  return out;
}
