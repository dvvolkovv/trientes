// Locale-aware "x ago" for unix-second timestamps. Used by the news rail so a
// headline reads "2 hr. ago" / "2 ч. назад" depending on the active locale.
// Pure (now is injectable) so it can be unit tested deterministically.
export function timeAgo(unixSeconds: number, locale = "en", now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const diffSec = Math.round(now / 1000 - unixSeconds);
  const abs = Math.abs(diffSec);
  // RelativeTimeFormat wants a negative value for things in the past.
  const sign = diffSec >= 0 ? -1 : 1;

  if (abs < 60) return rtf.format(sign * abs, "second");
  const min = Math.round(abs / 60);
  if (min < 60) return rtf.format(sign * min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(sign * hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 30) return rtf.format(sign * day, "day");
  const month = Math.round(day / 30);
  if (month < 12) return rtf.format(sign * month, "month");
  return rtf.format(sign * Math.round(month / 12), "year");
}
