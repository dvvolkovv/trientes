export function dexHref(locale: string): string {
  return `/exchange/?lang=${locale === "ru" ? "ru" : "en"}#/swap`;
}
