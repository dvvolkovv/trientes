// Традиционные рынки — четырьмя открытыми источниками без ключа, по одному на
// то, что он действительно отдаёт. Данные задержанные/индикативные, не
// биржевой поток.
//
// Почему не один источник, как было до 21 ноября 2026. Всё табло читалось у
// открытой службы графиков Yahoo, и живой замер показал её бюджет для нашего
// адреса: около одной котировки в полминуты, причём от паузы между запросами
// он не зависит. Десять инструментов при таком бюджете обходятся часами, а в
// пачке отказов (21 ноября служба отвечала 429 **на всё**, включая
// многосимвольные виды и запрос с cookie) не обходятся вовсе: самая ветхая
// карточка табло простояла 16 часов, и это видно глазом. Один враждебный
// источник на десять инструментов — не источник, а узкое место.
//
// Кто что отдаёт (всё проверено живым запросом 21 ноября 2026):
//
// • FRED (Федеральный резерв, Сент-Луис) — `fredgraph.csv?id=…` без ключа и
//   без месячного запаса: дневные закрытия DJIA, SP500, NASDAQCOM. Это
//   официальный ряд самого индекса; задержка 0–1 день, ход за день считается
//   по двум последним точкам **того же ряда** (автор числа один). Сверка с
//   прежним источником сошлась дословно: DJIA 48 147,33 и −1,934 %.
// • api.nasdaq.com — своя служба владельца индекса: Nasdaq Composite (COMP) с
//   ходом за день, прошлым закрытием и дневным размахом. Индексы чужих бирж
//   (Dow, S&P) она не знает, товарных контрактов тоже не отдаёт — проверено.
// • api.gold-api.com — спотовая цена металла (XAU, XAG, XPT, XPD) без ключа,
//   свежая на минуту. Хода за день она не сообщает, и мы его не выдумываем:
//   карточка остаётся без процента, а не с нашим вычислением под видом факта.
//   Названия карточек табло всегда были «золото», «серебро», — то есть металл,
//   а не ближний контракт COMEX, и спот им отвечает честнее.
// • FRED же отдаёт энергоносители: `DCOILWTICO` (нефть WTI, Кушинг) и
//   `DHHNGSP` (газ, Henry Hub). Это спотовая цена сырья с задержкой в
//   несколько дней, а не ближний контракт NYMEX, — ровно тот же выбор, что у
//   металлов: карточка табло называется «нефть», то есть сырьё, и дата ряда у
//   неё на виду.
//
// Почему Yahoo больше нет ни у одного инструмента. 21 ноября 2026 он отвечал
// нашему адресу 429 **на всё** — на график одного символа, на многосимвольные
// виды, на оба входа (query1, query2), с cookie `A3` от fc.yahoo.com и без
// неё. Это не бюджет окна, а отказ адресу: его три карточки простояли ветхими
// 18 часов, и ночной отчёт жаловался на них каждую ночь. Карточка, которую
// нечем наполнить, с табло снимается (то же правило, что у посева карточек
// монет), а не живёт вечно ветхой.
//
// Поэтому **карточки фьючерса на S&P больше нет**: это контракт CME, его цену
// без ключа не отдаёт никто (ни FRED, ни Nasdaq, ни CBOE — у последнего
// `cdn.cboe.com` отвечает нашему адресу 403 Cloudflare), а сам индекс S&P 500
// на табло и так стоит своей карточкой от FRED. Девять карточек, которые мы
// умеем наполнить, честнее десяти, из которых одна всегда вчерашняя.
//
// Почему не CNBC (источник до 18 ноября): с 16 ноября 2026, 23:08,
// quote.cnbc.com отвечает нашему адресу 403 на любой запрос — с браузерным UA,
// с referer и origin тоже. Почему не Stooq и не CME: Stooq отдаёт 404 на
// запрос котировок, а cmegroup.com банит адрес за автоматический доступ (их же
// Data Terms of Use его запрещают). Почему не Twelve Data, хотя ключ лежит в
// `.env`: на тарифе Basic из инструментов табло доступен один (XAU/USD).
// Почему не ключи с регистрацией (Finnhub, Alpha Vantage, CryptoCompare): их
// надо заводить руками на почту владельца, а перечисленные выше источники
// закрывают ту же нужду без неё (то же решение, что в слайсе BL).

export type MarketGroup = "index" | "energy" | "metal";
export type MarketUnit = "usd" | "pts";

/** Кто отдаёт карточку. Один инструмент — один источник, второго автора нет. */
export type MarketSource = "fred" | "nasdaq" | "metal";

export type MarketInstrument = {
  /**
   * Наш ключ инструмента: он живёт в снимке и в карте спросов, поэтому записи
   * чужой службы в нём нет. Прежние ключи были в записи Yahoo («^DJI»,
   * «GC=F»), и после переезда источников они стали бы ложью внутри наших же
   * данных — переименованы вместе со сменой ключа снимка на v3.
   */
  symbol: string;
  name: string; // display name (proper nouns) or i18n key handled at render
  group: MarketGroup;
  unit: MarketUnit;
  source: MarketSource;
  /** Как инструмент называет его источник: «DJIA» у FRED, «XAU» у металлов. */
  sourceSymbol: string;
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
  { symbol: "DJI", name: "Dow Jones", group: "index", unit: "pts", source: "fred", sourceSymbol: "DJIA" },
  { symbol: "IXIC", name: "Nasdaq Composite", group: "index", unit: "pts", source: "nasdaq", sourceSymbol: "COMP" },
  { symbol: "GSPC", name: "S&P 500", group: "index", unit: "pts", source: "fred", sourceSymbol: "SP500" },
  { symbol: "WTI", name: "crude", group: "energy", unit: "usd", source: "fred", sourceSymbol: "DCOILWTICO" },
  { symbol: "NGAS", name: "natgas", group: "energy", unit: "usd", source: "fred", sourceSymbol: "DHHNGSP" },
  { symbol: "XAU", name: "gold", group: "metal", unit: "usd", source: "metal", sourceSymbol: "XAU" },
  { symbol: "XAG", name: "silver", group: "metal", unit: "usd", source: "metal", sourceSymbol: "XAG" },
  { symbol: "XPT", name: "platinum", group: "metal", unit: "usd", source: "metal", sourceSymbol: "XPT" },
  { symbol: "XPD", name: "palladium", group: "metal", unit: "usd", source: "metal", sourceSymbol: "XPD" },
];

const BY_SYMBOL = new Map(MARKET_INSTRUMENTS.map((i) => [i.symbol, i]));

/** Знает ли табло такой ключ. Снимок прежней формы им же и отсеивается. */
export function isMarketSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Ход за день от прошлого закрытия. Оба числа — одного источника. */
function movePct(last: number, prevClose: number | null): number | null {
  if (prevClose === null || !(prevClose > 0)) return null;
  return ((last - prevClose) / prevClose) * 100;
}

/**
 * Ряд FRED (`observation_date,<ряд>`) → карточка индекса.
 *
 * Берутся две последние точки с числом: последняя — закрытие, предыдущая —
 * опора хода за день. Пропуск в ряду обозначен точкой («.»), и такие строки
 * пропускаются, а не читаются нулём: выходной день — не падение индекса в нуль.
 *
 * Заголовок обязан назвать тот ряд, о котором спросили: иначе опечатка в
 * ссылке повесила бы на карточку чужой индекс (тот же охранник, что проверка
 * символа у Yahoo).
 *
 * Времени у закрытия нет — только дата, и `time` остаётся пустым. Размаха дня
 * и открытия ряд не содержит, и подставлять их нечем.
 */
export function parseFredCsv(symbol: string, body: string): MarketQuote | null {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst || inst.source !== "fred") return null;

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0].split(",").map((c) => c.trim());
  if (header.length < 2 || header[1].toUpperCase() !== inst.sourceSymbol.toUpperCase()) return null;

  const points: Array<{ date: string; value: number }> = [];
  for (const line of lines.slice(1)) {
    const [date, rawValue] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue;
    const value = num(rawValue);
    if (value === null || value <= 0) continue;
    points.push({ date, value });
  }
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;

  return {
    ...inst,
    date: last.date,
    time: null,
    open: null,
    high: null,
    low: null,
    last: last.value,
    changePct: movePct(last.value, prev?.value ?? null),
  };
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * «Nov 20, 2026» и «Nov 20, 2026 4:15 PM ET» → дата по записи ряда.
 *
 * Часы из этой подписи не берутся: они в восточном времени США, а перевод в
 * UTC зависит от перехода на летнее время, о котором строка не говорит.
 * Показать чужой час под нашей подписью «UTC» хуже, чем не показывать часа.
 */
export function parseNasdaqDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}

/** «22,513.01 - 23,837.76» → низ и верх дня. Одно число — не размах. */
function parseRange(raw: unknown): { low: number | null; high: number | null } {
  if (typeof raw !== "string") return { low: null, high: null };
  const parts = raw.split(/\s*-\s*/);
  if (parts.length !== 2) return { low: null, high: null };
  return { low: num(parts[0]), high: num(parts[1]) };
}

/**
 * Ответ api.nasdaq.com (`/api/quote/<ряд>/info?assetclass=index`) → карточка.
 *
 * Служба владельца индекса отдаёт цену, ход за день, прошлое закрытие и
 * дневной размах. Пустое `data` — её обычный ответ на незнакомый символ
 * (`rCode: 400` в теле при коде 200 у запроса), и это `null`, а не бросок.
 */
export function parseNasdaqQuote(symbol: string, body: string): MarketQuote | null {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst || inst.source !== "nasdaq") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const data = (raw as { data?: Record<string, unknown> | null })?.data;
  if (!data || typeof data !== "object") return null;
  if (typeof data.symbol === "string" && data.symbol.toUpperCase() !== inst.sourceSymbol) return null;

  const primary = data.primaryData as Record<string, unknown> | undefined;
  const last = num(primary?.lastSalePrice);
  if (last === null) return null;

  const stats = data.keyStats as Record<string, { value?: unknown }> | undefined;
  const { low, high } = parseRange(stats?.dayrange?.value);

  return {
    ...inst,
    date: parseNasdaqDate(primary?.lastTradeTimestamp),
    time: null,
    open: null,
    low,
    high,
    last,
    changePct: num(primary?.percentageChange) ?? movePct(last, num(stats?.previousclose?.value)),
  };
}

/**
 * Ответ api.gold-api.com (`/price/<металл>`) → карточка металла.
 *
 * Служба отдаёт только цену и свой штамп времени. Хода за день в ответе нет, и
 * карточка остаётся без процента: посчитать его можно было бы лишь по нашему
 * прежнему снимку, то есть выдать своё вычисление за факт источника.
 *
 * Валюта проверяется: в ответе есть поле `currency`, и цена в евро под
 * подписью «$» была бы хуже отсутствующей карточки.
 */
export function parseMetalPrice(symbol: string, body: string): MarketQuote | null {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst || inst.source !== "metal") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const d = raw as { symbol?: unknown; price?: unknown; currency?: unknown; updatedAt?: unknown };
  if (typeof d.symbol !== "string" || d.symbol.toUpperCase() !== inst.sourceSymbol) return null;
  if (typeof d.currency === "string" && d.currency.toUpperCase() !== "USD") return null;
  const last = num(d.price);
  if (last === null || last <= 0) return null;

  const at = typeof d.updatedAt === "string" ? Date.parse(d.updatedAt) : NaN;
  const iso = Number.isFinite(at) ? new Date(at).toISOString() : null;

  return {
    ...inst,
    date: iso ? iso.slice(0, 10) : null,
    time: iso ? iso.slice(11, 19) : null,
    open: null,
    high: null,
    low: null,
    last,
    changePct: null,
  };
}

/** Адреса источников. Ключ сети переопределять незачем: все четыре открытые. */
const SOURCE_URL: Record<MarketSource, (inst: MarketInstrument) => string> = {
  fred: (i) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(i.sourceSymbol)}`,
  nasdaq: (i) =>
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(i.sourceSymbol)}/info?assetclass=index`,
  metal: (i) => `https://api.gold-api.com/price/${encodeURIComponent(i.sourceSymbol)}`,
};

const SOURCE_PARSE: Record<MarketSource, (symbol: string, body: string) => MarketQuote | null> = {
  fred: parseFredCsv,
  nasdaq: parseNasdaqQuote,
  metal: parseMetalPrice,
};

// api.nasdaq.com голому клиенту отказывает — ему нужен браузерный UA.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/**
 * FRED, наоборот, браузерному UA не отвечает **вовсе**: его защита (Akamai)
 * запрос с таким UA не отклоняет, а подвешивает — живой замер 21 ноября дал
 * обрыв по сроку на любом варианте с подписью Chrome и ответ за 20–100 мс с
 * любым другим, включая наш собственный. Поэтому подпись у каждого источника
 * своя, и официальной службе мы называем себя честно, а не прикидываемся
 * браузером с чужого адреса.
 */
const SELF_UA = "trientes.org/1.0 (+https://trientes.org)";

const SOURCE_HEADERS: Record<MarketSource, Record<string, string>> = {
  nasdaq: { accept: "application/json", "user-agent": BROWSER_UA },
  fred: { accept: "text/csv", "user-agent": SELF_UA },
  metal: { accept: "application/json", "user-agent": SELF_UA },
};
/**
 * Пауза перед следующим запросом к **тому же** источнику. Живой прогон отказов
 * по частоте не дал ни у одного из трёх, и держать их за хвост незачем, —
 * но ноль означал бы обход всех девяти карточек одним залпом.
 */
const SOURCE_GAP_MS: Record<MarketSource, number> = { fred: 300, nasdaq: 300, metal: 300 };
/** Столько отказов по частоте подряд означает «бюджет окна этого источника исчерпан». */
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
 * таких ответов остальные запросы к **этому же** источнику — заведомые 429.
 */
type OneAnswer = { quote: MarketQuote } | { throttled: true } | { failed: true };

async function fetchOne(
  inst: MarketInstrument,
  timeoutMs: number,
  fetchImpl: MarketFetchLike,
): Promise<OneAnswer> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl(SOURCE_URL[inst.source](inst), {
        headers: SOURCE_HEADERS[inst.source],
        cache: "no-store",
        signal,
      });
      if (res.status === 429) return { throttled: true };
      if (!res.ok) return { failed: true };
      const q = SOURCE_PARSE[inst.source](inst.symbol, await res.text());
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
 * Самая ветхая карточка табло — та котировка, которую дольше всех не
 * обновляли, со своим штампом. Это и есть здоровье источников: ветхая карточка
 * называет и инструмент, и того, кто его отдаёт, — отчёту этого хватает, чтобы
 * сказать, какая именно служба замолчала.
 *
 * `null` означает «возраст неизвестен», а не «ноль»: так читается и пустое
 * табло, и снимок прежней формы без штампов (он самоизлечивается первым же
 * слиянием). Карточка без штампа рядом со штампованными ветхую не прячет.
 */
export function stalestQuote(quotes: MarketQuote[]): { quote: MarketQuote; at: Date } | null {
  let found: { quote: MarketQuote; at: Date } | null = null;
  for (const q of quotes) {
    const at = q.gotAt ? Date.parse(q.gotAt) : NaN;
    if (!Number.isFinite(at)) continue;
    if (!found || at < found.at.getTime()) found = { quote: q, at: new Date(at) };
  }
  return found;
}

export function stalestQuoteAt(quotes: MarketQuote[]): Date | null {
  return stalestQuote(quotes)?.at ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Всё табло. Пустой массив означает «источники нам отказали», а не «рынков
 * нет»: по нему `syncMarkets` оставляет прошлый снимок, и табло ветшает, а не
 * гаснет.
 *
 * Запросы идут **по одному с паузой** перед следующим к тому же источнику:
 * десять параллельных запросов к Yahoo прошли на четырёх инструментах из
 * десяти, остальные получили 429.
 *
 * Обход идёт **от самой ветхой карточки** (`marketFetchOrder`): под
 * ограничителем успевает пройти только первая горстка запросов, и обход от
 * начала списка означал бы, что хвост списка не обновляется никогда.
 *
 * Отказ по частоте прекращает обход **только того источника**, который отказал
 * (три подряд). До 21 ноября счёт был один на всё табло, потому что и источник
 * был один; теперь три отказа Yahoo не должны лишать табло металлов, за
 * которыми стоит совсем другая служба со своим бюджетом.
 */
export async function fetchMarkets(
  order: MarketInstrument[] = MARKET_INSTRUMENTS,
  opts: { timeoutMs?: number; gapMs?: number; fetchImpl?: MarketFetchLike } = {},
): Promise<MarketSweep> {
  const { timeoutMs = 10000, gapMs, fetchImpl = fetch } = opts;
  const quotes: MarketQuote[] = [];
  const asked: string[] = [];
  const throttled = new Map<MarketSource, number>();
  const lastAt = new Map<MarketSource, number>();

  for (const inst of order) {
    if ((throttled.get(inst.source) ?? 0) >= THROTTLE_GIVE_UP) continue;

    const gap = gapMs ?? SOURCE_GAP_MS[inst.source];
    const since = lastAt.get(inst.source);
    if (gap > 0 && since !== undefined) {
      const wait = gap - (Date.now() - since);
      if (wait > 0) await sleep(wait);
    }

    const a = await fetchOne(inst, timeoutMs, fetchImpl);
    lastAt.set(inst.source, Date.now());
    asked.push(inst.symbol);

    if ("quote" in a) {
      quotes.push(a.quote);
      throttled.set(inst.source, 0);
      continue;
    }
    if ("throttled" in a) throttled.set(inst.source, (throttled.get(inst.source) ?? 0) + 1);
  }
  return { quotes, asked };
}
