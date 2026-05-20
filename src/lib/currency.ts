import type { ExchangeRates } from "@/lib/coingecko";

export const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  RUB: "₽",
  GBP: "£",
  JPY: "¥",
  CNY: "CN¥",
  BTC: "₿",
  ETH: "Ξ",
};

// Decimals at-or-above 1; sub-1 prices use formatPrice's adaptive precision.
const DECIMALS: Record<Currency, number> = {
  USD: 2, EUR: 2, RUB: 2, GBP: 2, JPY: 0, CNY: 2,
  BTC: 6, ETH: 4,
};

export function convert(priceUsd: number, target: Currency, rates: ExchangeRates): number {
  const usdRate = rates.usd?.value;
  const targetRate = rates[target.toLowerCase()]?.value;
  if (!usdRate || !targetRate) return Number.NaN;
  return priceUsd * (targetRate / usdRate);
}

function decimalsForAmount(value: number, target: Currency): number {
  const base = DECIMALS[target];
  if (value >= 1) return base;
  // Sub-1: use up to 6 decimals for fiat-style, keep crypto decimals.
  if (target === "BTC" || target === "ETH") return base;
  return 6;
}

export function formatPriceInCurrency(
  priceUsd: number,
  target: Currency,
  rates: ExchangeRates,
): string {
  const v = convert(priceUsd, target, rates);
  if (Number.isNaN(v)) return "—";
  const decimals = decimalsForAmount(v, target);
  const sym = SYMBOLS[target];
  const num = v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sym}${num}`;
}

export function formatCompactInCurrency(
  amountUsd: number,
  target: Currency,
  rates: ExchangeRates,
): string {
  const v = convert(amountUsd, target, rates);
  if (Number.isNaN(v)) return "—";
  const sym = SYMBOLS[target];
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(2)}K`;
  return `${sym}${v.toFixed(2)}`;
}
