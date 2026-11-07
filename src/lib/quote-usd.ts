/**
 * Приведение котировки пары к доллару. Отдельный файл, потому что это
 * допущение, а не вычисление: мы объявляем стейблы равными доллару и честно
 * отказываемся от фиата, для которого у нас нет своего курса.
 */

/**
 * Стейблы, принимаемые за 1 USD. Допущение заявлено в описании методики:
 * внутридневное расхождение стейбла с долларом меньше разброса цен между
 * биржами, а своего оракула у нас нет.
 */
export const USD_QUOTES = new Set([
  "USD", "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "PYUSD", "USDD", "DAI",
]);

/** Монеты, через которые переводится крипто-котировка. Считаются первым проходом. */
export const ANCHORS = ["BTC", "ETH", "BNB", "SOL"] as const;
export type AnchorPrices = Partial<Record<string, number>>;

export type QuoteRouteError = "no_usd_route";

/**
 * Курс котировки к доллару: 1 для стейбла, наш собственный индекс для опорной
 * монеты, отказ для всего прочего (включая EUR и TRY — курсы ЦБ в ценовой
 * индекс сознательно не тянем).
 */
export function quoteToUsd(
  quote: string,
  anchors: AnchorPrices,
): { usd: number } | { error: QuoteRouteError } {
  const q = quote.toUpperCase();
  if (USD_QUOTES.has(q)) return { usd: 1 };
  const anchor = anchors[q];
  if (anchor != null && Number.isFinite(anchor) && anchor > 0) return { usd: anchor };
  return { error: "no_usd_route" };
}

export const isAnchor = (symbol: string): boolean =>
  (ANCHORS as readonly string[]).includes(symbol.toUpperCase());
