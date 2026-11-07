/**
 * Математика собственного ценового индекса. Чистые функции, без сети и базы:
 * это ядро, по которому у монеты появляется цена, и оно должно проверяться
 * построчно.
 *
 * Метод `VWMEDIAN_V1` — медиана по весу суточного объёма, а не VWAP. Чтобы
 * сдвинуть VWAP, достаточно одной биржи с накрученным оборотом; чтобы сдвинуть
 * взвешенную медиану, накрученной должна быть больше половины всего объёма.
 */

export type IndexCandidate = {
  /** Идентификатор рынка — возвращается обратно, чтобы отметить выбросы. */
  id: string;
  priceUsd: number;
  volumeUsd24h: number;
  changePct: number | null;
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type IndexResult = {
  priceUsd: number;
  change24h: number | null;
  volumeUsd24h: number;
  marketCount: number;
  spreadPct: number | null;
  confidence: Confidence;
  method: "VWMEDIAN_V1";
  /** Рынки, вошедшие в расчёт. */
  usedIds: string[];
  /** Рынки, отброшенные как выбросы: в таблице остаются, в индексе нет. */
  outlierIds: string[];
  /** Рынки ниже порога объёма, не участвовавшие в расчёте. */
  dustIds: string[];
};

export type IndexFailure = { error: "insufficient_markets" };

/** Ниже этого суточного объёма рынок считается пылью. */
export const DUST_VOLUME_USD = 1_000;
/** Отклонение от предварительной медианы, после которого рынок — выброс. */
export const OUTLIER_PCT = 20;

const HIGH_VOLUME_USD = 100_000;
const LOW_VOLUME_USD = 10_000;
const HIGH_SPREAD_PCT = 5;

/**
 * Значение, на котором накопленный вес переваливает за половину. При нулевых
 * весах вырождается в обычную медиану — иначе монета без объёма теряла бы цену.
 * Отрицательные значения допустимы: той же функцией считается изменение за сутки.
 */
export function weightedMedian(points: readonly { value: number; weight: number }[]): number | null {
  const sorted = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((s, p) => s + Math.max(0, p.weight), 0);
  if (total <= 0) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid].value
      : (sorted[mid - 1].value + sorted[mid].value) / 2;
  }

  let acc = 0;
  for (const p of sorted) {
    acc += Math.max(0, p.weight);
    if (acc >= total / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

function confidenceOf(
  marketCount: number,
  volumeUsd24h: number,
  spreadPct: number | null,
  dustOnly: boolean,
): Confidence {
  if (dustOnly) return "LOW";
  if (marketCount <= 1) return "LOW";
  if (volumeUsd24h < LOW_VOLUME_USD) return "LOW";
  if (spreadPct != null && spreadPct > OUTLIER_PCT) return "LOW";
  if (marketCount >= 3 && volumeUsd24h >= HIGH_VOLUME_USD && (spreadPct ?? 0) <= HIGH_SPREAD_PCT) {
    return "HIGH";
  }
  return "MEDIUM";
}

export function computeIndex(candidates: readonly IndexCandidate[]): IndexResult | IndexFailure {
  const valid = candidates.filter(
    (c) => Number.isFinite(c.priceUsd) && c.priceUsd > 0 && Number.isFinite(c.volumeUsd24h),
  );
  if (valid.length === 0) return { error: "insufficient_markets" };

  const fat = valid.filter((c) => c.volumeUsd24h >= DUST_VOLUME_USD);
  // Цена из пыли лучше, чем ничего, но только с явной оговоркой — поэтому
  // полный отсев возвращается обратно и опускает уверенность до LOW.
  const dustOnly = fat.length === 0;
  const pool = dustOnly ? valid : fat;
  const dustIds = dustOnly ? [] : valid.filter((c) => c.volumeUsd24h < DUST_VOLUME_USD).map((c) => c.id);

  const prelim = weightedMedian(pool.map((c) => ({ value: c.priceUsd, weight: c.volumeUsd24h })));
  if (prelim == null) return { error: "insufficient_markets" };

  const outliers = pool.filter((c) => Math.abs(c.priceUsd - prelim) / prelim > OUTLIER_PCT / 100);
  const used = pool.filter((c) => !outliers.includes(c));
  const final = used.length > 0 ? used : pool;

  const priceUsd = weightedMedian(final.map((c) => ({ value: c.priceUsd, weight: c.volumeUsd24h })));
  if (priceUsd == null) return { error: "insufficient_markets" };

  const volumeUsd24h = final.reduce((s, c) => s + c.volumeUsd24h, 0);
  const prices = final.map((c) => c.priceUsd);
  const spreadPct =
    final.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / priceUsd) * 100 : null;

  const changes = final.filter((c) => c.changePct != null);
  const change24h =
    changes.length > 0
      ? weightedMedian(changes.map((c) => ({ value: c.changePct as number, weight: c.volumeUsd24h })))
      : null;

  return {
    priceUsd,
    change24h,
    volumeUsd24h,
    marketCount: final.length,
    spreadPct,
    confidence: confidenceOf(final.length, volumeUsd24h, spreadPct, dustOnly),
    method: "VWMEDIAN_V1",
    usedIds: final.map((c) => c.id),
    outlierIds: used.length > 0 ? outliers.map((c) => c.id) : [],
    dustIds,
  };
}
