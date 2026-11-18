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
export const BADGE_PAD = 12;
export const BADGE_GAP = 8;
const DOT = 7;
const LABEL_SIZE = 13;
const SITE_SIZE = 12;
const SITE = "trientes.org";

/**
 * Ширина символа в долях кегля.
 *
 * Шрифта в SVG нет (тащить файл на чужую страницу мы не будем), поэтому ширину
 * надписи приходится считать самим. Прежде здесь стояла одна средняя цифра на
 * любой символ, и она врала там, где письмо шире латиницы: «Принимаем TAL»
 * считалось равным «We accept TAL», коробка выходила на 25 px уже надписи, и
 * на живом бейдже получалось «Принимаем TALentes.org» — надпись наезжала на
 * адрес сайта.
 *
 * Числа сняты обмером живого шрифта (canvas `measureText`, вес 600) и собраны
 * по равным ширинам. Это всё равно оценка: у Segoe UI, SF Pro и Roboto метрики
 * свои. Точность даёт не таблица, а `textLength` в самом SVG — см. ниже.
 */
const WIDTH_GROUPS: [number, string][] = [
  [0.31, "'"],
  [0.34, "ijl"],
  [0.35, " "],
  [0.37, "/IJ"],
  [0.38, ",."],
  [0.4, ":;"],
  [0.42, "-"],
  [0.44, "f"],
  [0.46, "!()"],
  [0.48, "t"],
  [0.49, "r"],
  [0.52, '"г'],
  [0.58, "zзт"],
  [0.59, "cсэ"],
  [0.6, "s"],
  [0.63, "вь"],
  [0.64, "LГя"],
  [0.65, "vxyух"],
  [0.67, "akа"],
  [0.68, "EFTeЁЕТекё"],
  [0.69, "oнопч"],
  [0.7, "0123456789бий"],
  [0.71, "hnuЗ"],
  [0.72, "SYbdgpqр"],
  [0.73, "CPZРСЭл"],
  [0.74, "ц"],
  [0.75, "ъ"],
  [0.76, "BБВЬ"],
  [0.77, "AKRVXАУХЯ"],
  [0.81, "UЧд"],
  [0.82, "GКм"],
  [0.83, "DЛ"],
  [0.84, "HNИЙНП"],
  [0.85, "OQО"],
  [0.89, "Д"],
  [0.9, "ы"],
  [0.92, "w"],
  [0.93, "Ц"],
  [0.94, "Ъ"],
  [0.97, "ю"],
  [0.99, "Фф"],
  [1, "MМж"],
  [1.04, "mЫ"],
  [1.06, "ш"],
  [1.1, "W"],
  [1.11, "щ"],
  [1.17, "Ю"],
  [1.22, "Ж"],
  [1.24, "Ш"],
  [1.33, "Щ"],
];

const CHAR_WIDTH: Record<string, number> = {};
for (const [width, chars] of WIDTH_GROUPS) {
  for (const ch of chars) CHAR_WIDTH[ch] = width;
}

/** Иероглиф и хангыль занимают полный кегль — это свойство письма, не шрифта. */
const WIDE_SCRIPTS =
  /[ᄀ-ᇿ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** Незнакомая буква считается средней латинской: занизить хуже, чем завысить. */
const DEFAULT_WIDTH = 0.72;

export function charWidth(ch: string): number {
  if (WIDE_SCRIPTS.test(ch)) return 1;
  return CHAR_WIDTH[ch] ?? DEFAULT_WIDTH;
}

/** Ширина надписи в пикселях, с округлением вверх: обрезать текст нельзя. */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return Math.ceil(em * fontSize);
}

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
  const textW = textWidth(text, LABEL_SIZE);
  const siteW = textWidth(SITE, SITE_SIZE);
  const width = BADGE_PAD + DOT + BADGE_GAP + textW + BADGE_GAP + siteW + BADGE_PAD;
  const dotX = BADGE_PAD;
  const textX = BADGE_PAD + DOT + BADGE_GAP;
  const siteX = textX + textW + BADGE_GAP;
  const mid = BADGE_HEIGHT / 2;
  const title = escapeXml(`${text} · ${SITE}`);

  // `textLength` с `lengthAdjust` — то, что делает коробку обещанием, а не
  // надеждой: браузер укладывает надпись ровно в отведённые ей пиксели, каким
  // бы шрифтом он её ни рисовал. Оценка выше нужна лишь для того, чтобы
  // подгонка была незаметной; наезда на адрес сайта не случится и при промахе.
  const fit = (w: number) => `textLength="${w}" lengthAdjust="spacingAndGlyphs"`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${BADGE_HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${BADGE_HEIGHT - 1}" rx="8" ` +
    `fill="${BG}" stroke="${HAIRLINE}"/>` +
    `<circle cx="${dotX + DOT / 2}" cy="${mid}" r="${DOT / 2}" fill="${ACCENT}"/>` +
    `<text x="${textX}" y="${mid}" ${fit(textW)} dominant-baseline="central" fill="${FG}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="${LABEL_SIZE}" ` +
    `font-weight="600">${escapeXml(text)}</text>` +
    `<text x="${siteX}" y="${mid}" ${fit(siteW)} dominant-baseline="central" fill="${MUTED}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="${SITE_SIZE}">` +
    `${SITE}</text>` +
    `</svg>`
  );
}
