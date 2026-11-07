export function formatPrice(value: number): string {
  if (value >= 1) {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (value === 0) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })}`;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Число без символа валюты и без экспоненты: комиссия перевода бывает и в
 * долях микроцента (0,00000263 TAL), и в единицах, а `1.2e-9` в ценнике
 * прочитать невозможно. Значащих цифр три — больше для комиссии не смысл, а шум.
 */
export function formatFeeAmount(value: number, significant = 3): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const floor = Math.abs(value) >= 1 ? 2 : 0;
  const decimals = Math.min(18, Math.max(floor, significant - 1 - exponent));
  const fixed = value.toFixed(decimals);
  if (decimals <= floor) return fixed;
  // Лишние нули убираем, но обязательные (копейки у чисел от единицы) остаются.
  const [whole, frac = ""] = fixed.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(floor, "0");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
