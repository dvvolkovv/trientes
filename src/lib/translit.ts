/**
 * Кириллический адрес → латинский запрос к геокодеру.
 *
 * Зачем вообще: адреса в OSM записаны латиницей, и ни Nominatim, ни Photon не
 * прощают похожего написания — живой прогон показал, что
 * «Гемайндеберггассе 8» даёт ноль ответов, а побуквенный перевод
 * («Gemaindeberggasse 8») — тоже ноль. Значит переводить должны мы, и не
 * побуквенно, а обратным практическим транскрибированием: по-русски немецкое
 * `ei` пишется «ай», `sch` — «ш», `eu`/`äu` — «ой».
 *
 * Соответствие неоднозначно (одно и то же «х» стоит и за `h`, и за `ch`),
 * поэтому кандидат не один: функция отдаёт упорядоченный список, и геокодеру
 * их задают по одному до первого непустого ответа.
 *
 * Умлауты подбирать не нужно: индекс Nominatim складывает `ä`, `ae` и `a` в
 * одно (живая проверка — «Barengasse», «Baerengasse» и «Bärengasse» находят
 * одну и ту же улицу), поэтому «ю» переводится в `u`, а не в `ü`.
 */

export type TranslitLang = "de" | "generic";

const CYRILLIC = /[Ѐ-ӿ]/;

export function hasCyrillic(s: string): boolean {
  return CYRILLIC.test(s);
}

/** Немецкоязычные страны — там действуют немецкие правила чтения. */
const GERMAN_SPEAKING = new Set(["AT", "DE", "CH", "LI"]);

/**
 * Страны, где адреса в OSM записаны кириллицей. Там переводить нечего:
 * кириллический запрос и есть верный, а латинский вариант был бы гаданием.
 */
const CYRILLIC_SCRIPT = new Set(["RU", "BY", "UA", "BG", "MK", "RS", "KZ", "KG", "TJ", "MN"]);

export function isCyrillicScriptCountry(cc: string | null | undefined): boolean {
  return !!cc && CYRILLIC_SCRIPT.has(cc.toUpperCase());
}

export function translitLangForCountry(cc: string | null | undefined): TranslitLang {
  return cc && GERMAN_SPEAKING.has(cc.toUpperCase()) ? "de" : "generic";
}

// Виды улиц: «плац» по общим правилам дало бы `plaz`, а конечное «н» в
// «гассен» приходит от распознавания речи, а не от немецкого языка.
const DE_SUFFIXES: Array<[string, string]> = [
  ["штрассен", "strasse"],
  ["штрассе", "strasse"],
  ["штрасе", "strasse"],
  ["гассен", "gasse"],
  ["гассе", "gasse"],
  ["аллее", "allee"],
  ["платц", "platz"],
  ["плац", "platz"],
  ["штайг", "steig"],
  ["штейг", "steig"],
  ["маркт", "markt"],
  ["уфер", "ufer"],
  ["ринг", "ring"],
  ["вег", "weg"],
];

// Многобуквенные соответствия идут первыми — иначе «ай» разберётся как «а»+«й».
const DE_DIGRAPHS: Array<[string, string]> = [
  ["шт", "st"],
  ["шп", "sp"],
  ["ай", "ei"],
  ["эй", "ei"],
  ["ей", "ei"],
  ["ой", "eu"],
  ["ау", "au"],
  ["ия", "ia"],
];

const DE_LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "w", г: "g", д: "d", е: "e", ё: "o", ж: "j", з: "s",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", ц: "z", ч: "tsch", ш: "sch", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "u", я: "ja",
};

const GENERIC_DIGRAPHS: Array<[string, string]> = [];

const GENERIC_LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Немецкое «х»: в начале слова это почти всегда `h` (Haupt-, Hirsch-, Hohen-),
 * внутри — `ch` (München). Слов на `ch` в немецком мало, поэтому начальное
 * правило именно такое; обратное прочтение уходит отдельным кандидатом.
 */
function germanH(atWordStart: boolean, flipped: boolean): string {
  const h = atWordStart ? "h" : "ch";
  if (!flipped) return h;
  return h === "h" ? "ch" : "h";
}

function translitWord(word: string, lang: TranslitLang, flipH: boolean): string {
  const digraphs = lang === "de" ? DE_DIGRAPHS : GENERIC_DIGRAPHS;
  const letters = lang === "de" ? DE_LETTERS : GENERIC_LETTERS;

  let rest = word;
  // Вид улицы снимается с конца целиком: он не читается по буквам.
  let tail = "";
  if (lang === "de") {
    for (const [ru, latin] of DE_SUFFIXES) {
      if (rest.endsWith(ru)) {
        tail = latin;
        rest = rest.slice(0, -ru.length);
        break;
      }
    }
  }

  let out = "";
  let i = 0;
  while (i < rest.length) {
    const two = rest.slice(i, i + 2);
    const pair = digraphs.find(([ru]) => ru === two);
    if (pair) {
      out += pair[1];
      i += 2;
      continue;
    }
    const ch = rest[i];
    if (lang === "de" && ch === "х") {
      out += germanH(i === 0, flipH);
      i += 1;
      continue;
    }
    const mapped = letters[ch];
    out += mapped === undefined ? ch : mapped;
    i += 1;
  }
  return out + tail;
}

function capitalize(s: string): string {
  return s.replace(/(^|[\s\-/.])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toUpperCase());
}

function render(q: string, lang: TranslitLang, joinHyphens: boolean, flipH: boolean): string {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = words.map((word) => {
    if (!hasCyrillic(word)) return word;
    const parts = word.split("-").filter(Boolean);
    const latin = parts.map((p) => translitWord(p, lang, flipH));
    return joinHyphens ? latin.join("") : latin.join(" ");
  });
  return capitalize(out.join(" ")).trim();
}

/**
 * Упорядоченные латинские варианты кириллического запроса — самый вероятный
 * первым, не больше трёх. Латинскому запросу возвращается пустой список:
 * переводить нечего.
 *
 * Варианты отличаются двумя решениями, которые из букв не выводятся:
 * дефис внутри слова («Гемайнде-Берг-Гассе» — это одно немецкое слово) и
 * прочтение «х».
 */
export function latinQueryCandidates(q: string, lang: TranslitLang = "generic"): string[] {
  const query = q.trim();
  if (!query || !hasCyrillic(query)) return [];
  const variants = [
    render(query, lang, true, false),
    render(query, lang, false, false),
    ...(lang === "de" ? [render(query, lang, true, true)] : []),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Порядок запросов к геокодеру: что пробовать первым, что потом.
 *
 * Кириллический запрос в латинской стране идёт **вторым**, а не первым, и это
 * вывод живого прогона: «Гран Виа 8» Nominatim находит, но отдаёт два объекта,
 * названных этим адресом, тогда как «Gran Via 8» — пять настоящих адресов.
 * Города же находятся обоими способами («Вена» и «Vena» одинаково дают Wien),
 * поэтому латиницей ничего не теряется.
 *
 * В кириллической стране (Россия, Беларусь, Болгария…) латинских вариантов
 * нет вовсе: адрес там так и записан, а перевод был бы гаданием. Когда страна
 * неизвестна, первым идёт то, что человек напечатал: искать можно и дома.
 */
export function geocodeQueryOrder(q: string, cc: string | null | undefined): string[] {
  const query = q.trim();
  if (!hasCyrillic(query)) return [query];
  if (isCyrillicScriptCountry(cc)) return [query];
  const latin = latinQueryCandidates(query, translitLangForCountry(cc));
  if (latin.length === 0) return [query];
  return cc ? [...latin, query] : [query, ...latin];
}
