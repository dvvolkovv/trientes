/**
 * Реестр публичных CEX-коннекторов. Каждая биржа описана декларативно: адрес
 * снимка всех тикеров, парсер ответа, форма символа пары и имена, по которым
 * её узнаёт свободный ввод проекта. Добавление девятой биржи — запись здесь,
 * без изменений в агрегаторе.
 *
 * Ключей ни одна биржа не требует; базовый адрес переопределяется через
 * `CEX_BASE_<ID>` в `.env` — тем же приёмом, что RPC в слайсе B.
 */

/** Цена и суточный объём в единицах котировки (не в долларах). */
export type Ticker = {
  /** Символ пары на бирже, как он найден в снимке. */
  nativeSymbol: string;
  price: number;
  /** Объём за 24 ч в котировке; null — биржа его не отдаёт. */
  quoteVolume: number | null;
  /** Изменение за 24 ч в процентах; null — не отдаёт. */
  changePct: number | null;
};

export type TickerMap = Map<string, Ticker>;

export type CexConnector = {
  id: string;
  label: string;
  /** Путь снимка относительно базового адреса. */
  path: string;
  defaultBase: string;
  /** Имена, под которыми биржа встречается в свободном вводе. */
  aliases: readonly string[];
  /** Кандидаты символа пары — первый найденный в снимке и есть наш рынок. */
  symbols(base: string, quote: string): string[];
  parse(body: unknown): TickerMap;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Цена обязана быть положительной: 0 и мусор — не цена, а отсутствие рынка. */
const price = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

const vol = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};

function rows(body: unknown, pick: (b: Record<string, unknown>) => unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const inner = pick(body as Record<string, unknown>);
  return Array.isArray(inner) ? inner : [];
}

function put(map: TickerMap, nativeSymbol: unknown, t: Omit<Ticker, "nativeSymbol">): void {
  if (typeof nativeSymbol !== "string" || !nativeSymbol) return;
  if (t.price == null) return;
  map.set(nativeSymbol.toUpperCase(), { nativeSymbol, ...t });
}

const pctFromOpen = (last: number, open: unknown): number | null => {
  const o = price(open);
  return o == null ? null : ((last - o) / o) * 100;
};

/** Binance и MEXC отдают один и тот же формат `/ticker/24hr`. */
function parseBinanceLike(body: unknown): TickerMap {
  const map: TickerMap = new Map();
  for (const raw of rows(body, () => null)) {
    const r = raw as Record<string, unknown>;
    const p = price(r.lastPrice ?? r.price);
    if (p == null) continue;
    put(map, r.symbol, {
      price: p,
      quoteVolume: vol(r.quoteVolume),
      changePct: num(r.priceChangePercent),
    });
  }
  return map;
}

const KRAKEN_ALIAS: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

export const CEX: readonly CexConnector[] = [
  {
    id: "binance",
    label: "Binance",
    path: "/api/v3/ticker/24hr",
    defaultBase: "https://api.binance.com",
    aliases: ["binance", "binancespot", "binanceglobal", "binancecom"],
    symbols: (b, q) => [`${b}${q}`],
    parse: parseBinanceLike,
  },
  {
    id: "mexc",
    label: "MEXC",
    path: "/api/v3/ticker/24hr",
    defaultBase: "https://api.mexc.com",
    aliases: ["mexc", "mexcglobal", "mxc"],
    symbols: (b, q) => [`${b}${q}`],
    parse: parseBinanceLike,
  },
  {
    id: "okx",
    label: "OKX",
    path: "/api/v5/market/tickers?instType=SPOT",
    defaultBase: "https://www.okx.com",
    aliases: ["okx", "okex"],
    symbols: (b, q) => [`${b}-${q}`],
    parse(body) {
      const map: TickerMap = new Map();
      for (const raw of rows(body, (b) => b.data)) {
        const r = raw as Record<string, unknown>;
        const p = price(r.last);
        if (p == null) continue;
        put(map, r.instId, {
          price: p,
          // volCcy24h у спота — объём в котировке.
          quoteVolume: vol(r.volCcy24h),
          changePct: pctFromOpen(p, r.open24h),
        });
      }
      return map;
    },
  },
  {
    id: "bybit",
    label: "Bybit",
    path: "/v5/market/tickers?category=spot",
    defaultBase: "https://api.bybit.com",
    aliases: ["bybit", "bybitspot"],
    symbols: (b, q) => [`${b}${q}`],
    parse(body) {
      const map: TickerMap = new Map();
      const result = (body as { result?: { list?: unknown } } | null)?.result;
      for (const raw of Array.isArray(result?.list) ? result.list : []) {
        const r = raw as Record<string, unknown>;
        const p = price(r.lastPrice);
        if (p == null) continue;
        const pct = num(r.price24hPcnt);
        put(map, r.symbol, {
          price: p,
          quoteVolume: vol(r.turnover24h),
          changePct: pct == null ? null : pct * 100,
        });
      }
      return map;
    },
  },
  {
    id: "kucoin",
    label: "KuCoin",
    path: "/api/v1/market/allTickers",
    defaultBase: "https://api.kucoin.com",
    aliases: ["kucoin", "kucoinspot"],
    symbols: (b, q) => [`${b}-${q}`],
    parse(body) {
      const map: TickerMap = new Map();
      const data = (body as { data?: { ticker?: unknown } } | null)?.data;
      for (const raw of Array.isArray(data?.ticker) ? data.ticker : []) {
        const r = raw as Record<string, unknown>;
        const p = price(r.last);
        if (p == null) continue;
        const rate = num(r.changeRate);
        put(map, r.symbol, {
          price: p,
          quoteVolume: vol(r.volValue),
          changePct: rate == null ? null : rate * 100,
        });
      }
      return map;
    },
  },
  {
    id: "gate",
    label: "Gate.io",
    path: "/api/v4/spot/tickers",
    defaultBase: "https://api.gateio.ws",
    aliases: ["gate", "gateio", "gatecom", "gateiospot"],
    symbols: (b, q) => [`${b}_${q}`],
    parse(body) {
      const map: TickerMap = new Map();
      for (const raw of rows(body, () => null)) {
        const r = raw as Record<string, unknown>;
        const p = price(r.last);
        if (p == null) continue;
        put(map, r.currency_pair, {
          price: p,
          quoteVolume: vol(r.quote_volume),
          changePct: num(r.change_percentage),
        });
      }
      return map;
    },
  },
  {
    id: "kraken",
    label: "Kraken",
    path: "/0/public/Ticker",
    defaultBase: "https://api.kraken.com",
    aliases: ["kraken"],
    symbols: (b, q) => {
      const base = KRAKEN_ALIAS[b] ?? b;
      const quote = KRAKEN_ALIAS[q] ?? q;
      // Kraken держит и старые имена с классами активов (XXBTZUSD), и новые.
      return [
        `${base}${quote}`,
        `X${base}Z${quote}`,
        `XX${base}ZZ${quote}`,
        `X${base}${quote}`,
      ];
    },
    parse(body) {
      const map: TickerMap = new Map();
      const result = (body as { result?: Record<string, unknown> } | null)?.result;
      if (!result || typeof result !== "object") return map;
      for (const [symbol, raw] of Object.entries(result)) {
        const r = raw as Record<string, unknown>;
        const c = Array.isArray(r.c) ? r.c[0] : null;
        const p = price(c);
        if (p == null) continue;
        const baseVol = vol(Array.isArray(r.v) ? r.v[1] : null);
        const vwap = price(Array.isArray(r.p) ? r.p[1] : null);
        put(map, symbol, {
          price: p,
          quoteVolume: baseVol != null && vwap != null ? baseVol * vwap : null,
          changePct: pctFromOpen(p, r.o),
        });
      }
      return map;
    },
  },
  {
    id: "coinbase",
    label: "Coinbase",
    path: "/products/stats",
    defaultBase: "https://api.exchange.coinbase.com",
    aliases: ["coinbase", "coinbasepro", "coinbaseexchange", "gdax"],
    symbols: (b, q) => [`${b}-${q}`],
    parse(body) {
      const map: TickerMap = new Map();
      if (!body || typeof body !== "object" || Array.isArray(body)) return map;
      for (const [symbol, raw] of Object.entries(body as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object") continue;
        const holder = raw as Record<string, unknown>;
        const s = (holder.stats_24hour ?? holder) as Record<string, unknown>;
        const p = price(s.last);
        if (p == null) continue;
        // Coinbase даёт объём в базовой монете — переводим в котировку сами.
        const baseVol = vol(s.volume);
        put(map, symbol, {
          price: p,
          quoteVolume: baseVol == null ? null : baseVol * p,
          changePct: pctFromOpen(p, s.open),
        });
      }
      return map;
    },
  },
];

const BY_ID = new Map(CEX.map((c) => [c.id, c]));

export function getConnector(id: string): CexConnector | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Свободный ввод проекта («Binance», «binance spot», «Gate.io») — в id
 * коннектора. Неизвестная биржа возвращает null: мы честно её не читаем.
 */
export function normalizeExchange(raw: string | null | undefined): string | null {
  const key = (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  for (const c of CEX) {
    if (c.aliases.includes(key)) return c.id;
  }
  return null;
}

/** Адрес снимка с учётом переопределения в `.env`. */
export function snapshotUrl(c: CexConnector, env: Record<string, string | undefined> = process.env): string {
  const base = env[`CEX_BASE_${c.id.toUpperCase()}`]?.replace(/\/+$/, "") || c.defaultBase;
  return `${base}${c.path}`;
}

/** Первый кандидат символа, найденный в снимке. */
export function lookupTicker(
  c: CexConnector,
  tickers: TickerMap,
  base: string,
  quote: string,
): Ticker | null {
  for (const symbol of c.symbols(base, quote)) {
    const hit = tickers.get(symbol.toUpperCase());
    if (hit) return hit;
  }
  return null;
}
