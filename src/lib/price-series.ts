// Pure stats for the Simple price chart's header readout. No deps, so both the
// client component and unit tests can use it.

export type SeriesPoint = { time: number; value: number };

export type SeriesSummary = {
  first: number;
  last: number;
  min: number;
  max: number;
  change: number; // last - first
  changePct: number; // % vs first; 0 when first is 0 (avoids div-by-zero)
};

export function summarizeSeries(points: SeriesPoint[]): SeriesSummary | null {
  if (points.length === 0) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  let min = points[0].value;
  let max = points[0].value;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const change = last - first;
  const changePct = first === 0 ? 0 : (change / first) * 100;
  return { first, last, min, max, change, changePct };
}
