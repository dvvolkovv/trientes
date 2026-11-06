// Бейдж для чужого сайта: статичный SVG без скриптов, без внешних ссылок на
// шрифты и без какой-либо телеметрии — это не наша страница.
// Цвета взяты из токенов темы (src/app/globals.css), новый визуальный язык
// не изобретается.

const BG = "#161616";
const HAIRLINE = "#2a2932";
const FG = "#ffffff";
const MUTED = "#a09baa";
const ACCENT = "#fe5c04";

export const BADGE_HEIGHT = 36;
const PAD = 12;
const DOT = 7;
const GAP = 8;
/** Средняя ширина символа при font-size 13 в системном sans. Шрифта в SVG нет,
 *  поэтому ширину считаем приближённо и с запасом — обрезать текст нельзя. */
const CHAR_W = 7.1;
const SITE = "trientes.org";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function buildAcceptBadgeSvg({
  label,
  symbol,
}: {
  label: string;
  symbol: string;
}): string {
  const text = `${collapse(label)} ${collapse(symbol).toUpperCase()}`.trim();
  const textW = Math.ceil(text.length * CHAR_W);
  const siteW = Math.ceil(SITE.length * (CHAR_W - 1));
  const width = PAD + DOT + GAP + textW + GAP + siteW + PAD;
  const dotX = PAD;
  const textX = PAD + DOT + GAP;
  const siteX = textX + textW + GAP;
  const mid = BADGE_HEIGHT / 2;
  const title = escapeXml(`${text} · ${SITE}`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${BADGE_HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${BADGE_HEIGHT - 1}" rx="8" ` +
    `fill="${BG}" stroke="${HAIRLINE}"/>` +
    `<circle cx="${dotX + DOT / 2}" cy="${mid}" r="${DOT / 2}" fill="${ACCENT}"/>` +
    `<text x="${textX}" y="${mid}" dominant-baseline="central" fill="${FG}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="13" ` +
    `font-weight="600">${escapeXml(text)}</text>` +
    `<text x="${siteX}" y="${mid}" dominant-baseline="central" fill="${MUTED}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12">` +
    `${SITE}</text>` +
    `</svg>`
  );
}
