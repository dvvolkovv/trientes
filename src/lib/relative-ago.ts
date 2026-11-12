/**
 * «Обновлено N назад» одной строкой. Отдельный файл, потому что подпись нужна
 * и метрикам карточки биржи, и списку монет на ней, а копия формулы в двух
 * компонентах разошлась бы на первой же правке.
 */
export function relativeAgo(
  now: number,
  then: number,
  t: (key: string, vals?: Record<string, number>) => string,
): string {
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 30) return t("freshness.justNow");
  if (sec < 60) return t("freshness.secAgo", { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("freshness.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("freshness.hourAgo", { n: hr });
  const day = Math.floor(hr / 24);
  return t("freshness.dayAgo", { n: day });
}
