/**
 * Разбор свободной строки пары («TAL/USDT», «tal-usdt», «TALUSDT») в базу и
 * котировку. Проект вводит пару руками, биржи пишут её по-разному, а ошибка
 * разбора означает, что мы подставим чужую цену под монету, — поэтому разбор
 * чистый, тестируемый и отдельно от всего остального.
 */

/** Котировки, по которым узнаётся склеенная форма. Длинные — первыми. */
export const KNOWN_QUOTES = [
  "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "PYUSD", "USDD", "DAI",
  "BTC", "ETH", "BNB", "SOL", "TRX", "XRP",
  "EUR", "TRY", "BRL", "GBP", "JPY", "USD",
] as const;

const SEPARATORS = /[/\-_:]/;
const TICKER = /^[A-Z0-9.]{1,20}$/;

export type ParsedPair = { base: string; quote: string };

export function parsePair(raw: string | null | undefined): ParsedPair | null {
  const text = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return null;

  if (SEPARATORS.test(text)) {
    const [base, quote, ...rest] = text.split(SEPARATORS);
    if (rest.length > 0) return null; // «BTC/USDT/PERP» — не спотовая пара
    if (!base || !quote || !TICKER.test(base) || !TICKER.test(quote)) return null;
    return { base, quote };
  }

  // Склеенная форма: отрезаем самую длинную известную котировку.
  const byLength = [...KNOWN_QUOTES].sort((a, b) => b.length - a.length);
  for (const quote of byLength) {
    if (text.length > quote.length && text.endsWith(quote)) {
      const base = text.slice(0, -quote.length);
      if (TICKER.test(base)) return { base, quote };
    }
  }
  return null;
}
