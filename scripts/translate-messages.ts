/**
 * Перевод интерфейсных строк на новый язык: messages/en.json → messages/<locale>.json.
 *
 * Почему скриптом, а не руками: в en.json ~1940 строк, и ручная правка такого
 * файла гарантированно расходится с источником по ключам. Здесь структура и
 * порядок ключей берутся из английского файла, так что расхождение невозможно
 * по построению — переводится только значение листа.
 *
 * Прогон идемпотентный: уже переведённые ключи не переспрашиваются (это важно,
 * потому что сеть рвётся, а платить за перевод второй раз незачем). Нужен
 * полный пересчёт — флаг --force.
 *
 *   npx tsx scripts/translate-messages.ts hr             # перевести отсутствующее
 *   npx tsx scripts/translate-messages.ts hr --force     # перевести всё заново
 *   npx tsx scripts/translate-messages.ts hr --dump      # что осталось непереведённым
 *   npx tsx scripts/translate-messages.ts hr --restyle   # привести подписи кнопок к одной форме
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env") });

type Node = string | string[] | Tree;
type Tree = { [k: string]: Node };

const LANGUAGE_NAMES: Record<string, string> = {
  hr: "Croatian (hrvatski)",
  ru: "Russian",
  de: "German",
  es: "Spanish",
  fr: "French",
  ja: "Japanese",
  ko: "Korean",
  "pt-BR": "Brazilian Portuguese",
  tr: "Turkish",
  "zh-CN": "Simplified Chinese",
};

/**
 * Глоссарий нужен не для красоты: одно и то же слово в разных частях сайта
 * должно переводиться одинаково, иначе пользователь думает, что это разные
 * сущности. Модель сама по себе этого не гарантирует — она видит батч, а не
 * весь файл.
 */
const GLOSSARY: Record<string, string> = {
  hr: [
    "Trientes — brand name, never translate.",
    "coin → kovanica; token → token; blockchain → blockchain; wallet → novčanik",
    "exchange (trading venue) → burza; swap → zamjena; DEX → DEX",
    "watchlist → popis praćenja; market cap → tržišna kapitalizacija",
    "circulating supply → ponuda u optjecaju; total supply → ukupna ponuda",
    "fee → naknada; gas → gas; block → blok; finality → konačnost",
    "staking → stakanje; validator → validator; mining → rudarenje",
    "listing → uvrštenje; request → zahtjev; alert → upozorenje",
    "cabinet (user area) → profil; business cabinet → poslovni profil",
    "point (physical place accepting crypto) → lokacija",
    "merchant → trgovac; navigator (map of places) → navigator",
    "sign in → prijava; sign up / register → registracija; settings → postavke",
    "Use the formal-neutral register common on Croatian product UIs (infinitive or 2nd person plural, not 'ti').",
  ].join("\n"),
};

/**
 * Второй прогон по уже переведённому файлу: машинный перевод смешивает формы
 * повелительного наклонения («Spremi profil») и инфинитива («Spremiti profil»),
 * а в интерфейсе подписи кнопок должны быть в одной форме. Правится только то,
 * что начинается с глагола в инфинитиве, — остальное модель обязана вернуть как
 * есть (под фильтр попадают и существительные вроде «Vijesti»).
 */
const RESTYLE: Record<string, { match: RegExp; instruction: string }> = {
  hr: {
    // Инфинитив («Spremiti profil») и повелительное единственного числа
    // («Spremi profil»): и то и другое приводим к «вы»-форме, которой уже
    // написана вся проза файла. Второй список — закрытый перечень глаголов,
    // потому что по виду слова единственное число не угадывается.
    match: new RegExp(
      "^(?:[A-ZČĆŠŽĐ][a-zčćšžđ]{2,}(?:ti|ći)\\b" +
        "|(?:Dodaj|Spremi|Odaberi|Pretraži|Očisti|Pošalji|Prijavi|Odjavi|Uredi|Izbriši|Obriši" +
        "|Potvrdi|Otkaži|Nastavi|Kopiraj|Prikaži|Sakrij|Zatraži|Pokušaj|Učitaj|Pregledaj|Odobri" +
        "|Odbij|Vrati|Isključi|Uključi|Preuzmi|Otvori|Zatvori|Promijeni|Postavi|Poveži|Ukloni" +
        "|Registriraj|Stvori|Usporedi|Prati|Unesi|Napiši|Pozovi|Primijeni|Poništi|Moderiraj" +
        "|Upravljaj|Pronađi|Pokaži|Isprobaj|Plati|Kreiraj|Dovrši|Zamijeni|Pauziraj)\\b)",
    ),
    instruction: [
      "These are Croatian UI strings (button labels, hints, section subtitles).",
      "If a string is an action addressed to the user written in the infinitive",
      '("Spremiti profil") or in the 2nd-person-singular imperative ("Spremi profil"),',
      'rewrite it in the 2nd-person-plural imperative ("Spremite profil") — the whole',
      "product speaks to the user as 'vi', so every label must match.",
      'If the string is NOT such an action (a noun like "Vijesti", an adjective, a label,',
      "or already 2nd-person-plural), return it completely unchanged.",
      "Change nothing else: no wording, no punctuation, no placeholders.",
      "Output JSON only: same keys, final values.",
    ].join(" "),
  },
};

const BATCH = 40;
const CONCURRENCY = 4;
const MODEL = process.env.TRANSLATE_MODEL ?? "gpt-5";

function flatten(node: Node, prefix: string, out: [string, string][]): void {
  if (typeof node === "string") {
    out.push([prefix, node]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

/** Собирает дерево обратно по форме английского файла: форму задаёт источник. */
function rebuild(enNode: Node, prefix: string, translated: Map<string, string>): Node {
  if (typeof enNode === "string") return translated.get(prefix) ?? enNode;
  if (Array.isArray(enNode)) {
    return enNode.map((item, i) => rebuild(item, `${prefix}[${i}]`, translated) as string);
  }
  const out: Tree = {};
  for (const [k, v] of Object.entries(enNode)) {
    out[k] = rebuild(v, prefix ? `${prefix}.${k}` : k, translated);
  }
  return out;
}

/** Плейсхолдеры `{count}` — контракт с кодом: потеря любого ломает рендер. */
function placeholders(s: string): string[] {
  return (s.match(/\{[^}]+\}/g) ?? []).sort();
}

const client = new OpenAI();

async function translateBatch(
  entries: [string, string][],
  languageName: string,
  glossary: string,
): Promise<Map<string, string>> {
  const payload: Record<string, string> = {};
  for (const [k, v] of entries) payload[k] = v;

  const system = [
    `You translate UI strings of a cryptocurrency market website from English into ${languageName}.`,
    "",
    "Rules:",
    `- Translate only the VALUES. Keys are code identifiers — copy them verbatim.`,
    "- Keep every placeholder exactly as written, including braces: {count}, {name}, {symbol}.",
    "- Keep technical tokens untranslated: WebGL2, API, URL, CSV, JSON, RPC, SS58, KYB, OSM, Telegram, Google, GitHub, coin tickers (BTC, ETH).",
    "- Keep the string's role: a button label stays short, a hint stays a hint. Do not add or drop sentences.",
    "- No trailing punctuation that the source does not have.",
    "- Output JSON only: the same keys, translated values.",
    "",
    "Glossary (use these equivalents consistently):",
    glossary,
  ].join("\n");

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload, null, 1) },
    ],
    response_format: { type: "json_object" },
    // Перевод — не рассуждение: низкое усилие держит батч в разумных секундах,
    // а качество решает глоссарий в системном сообщении.
    reasoning_effort: "low",
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const [k, v] of entries) {
    const got = parsed[k];
    if (typeof got !== "string" || !got.trim()) continue;
    // Расхождение по плейсхолдерам — брак: лучше оставить английский,
    // чем отдать в рендер строку, где пропал {count}.
    if (placeholders(got).join("|") !== placeholders(v).join("|")) continue;
    out.set(k, got.trim());
  }
  return out;
}

async function restyleBatch(
  entries: [string, string][],
  instruction: string,
): Promise<Map<string, string>> {
  const payload: Record<string, string> = {};
  for (const [k, v] of entries) payload[k] = v;
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: JSON.stringify(payload, null, 1) },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "low",
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const [k, v] of entries) {
    const got = parsed[k];
    if (typeof got !== "string" || !got.trim()) continue;
    if (placeholders(got).join("|") !== placeholders(v).join("|")) continue;
    out.set(k, got.trim());
  }
  return out;
}

async function restyle(locale: string): Promise<void> {
  const rule = RESTYLE[locale];
  if (!rule) {
    console.error(`no restyle rule for ${locale}`);
    process.exit(1);
  }
  const dir = path.join(process.cwd(), "messages");
  const target = path.join(dir, `${locale}.json`);
  const tree = JSON.parse(readFileSync(target, "utf8")) as Tree;
  const flat: [string, string][] = [];
  flatten(tree, "", flat);
  const suspects = flat.filter(([, v]) => rule.match.test(v));
  console.log(`${locale}: ${suspects.length} of ${flat.length} strings look like infinitive labels`);

  const fixed = new Map(flat);
  let changed = 0;
  for (let i = 0; i < suspects.length; i += BATCH) {
    const batch = suspects.slice(i, i + BATCH);
    const got = await restyleBatch(batch, rule.instruction);
    for (const [k, v] of got) {
      if (v !== fixed.get(k)) changed++;
      fixed.set(k, v);
    }
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${got.size}/${batch.length}`);
  }
  const en = JSON.parse(readFileSync(path.join(dir, "en.json"), "utf8")) as Tree;
  writeFileSync(target, `${JSON.stringify(rebuild(en, "", fixed), null, 2)}\n`);
  console.log(`rewrote ${target}: ${changed} strings restyled`);
}

async function main() {
  const [locale, ...flags] = process.argv.slice(2);
  if (!locale) {
    console.error("usage: npx tsx scripts/translate-messages.ts <locale> [--force] [--dump]");
    process.exit(1);
  }
  if (flags.includes("--restyle")) {
    await restyle(locale);
    return;
  }
  const force = flags.includes("--force");
  const dump = flags.includes("--dump");
  const languageName = LANGUAGE_NAMES[locale];
  if (!languageName) {
    console.error(`unknown locale ${locale}: add it to LANGUAGE_NAMES first`);
    process.exit(1);
  }

  const dir = path.join(process.cwd(), "messages");
  const en = JSON.parse(readFileSync(path.join(dir, "en.json"), "utf8")) as Tree;
  const target = path.join(dir, `${locale}.json`);
  const existing: Tree =
    existsSync(target) && !force ? (JSON.parse(readFileSync(target, "utf8")) as Tree) : {};

  const enFlat: [string, string][] = [];
  flatten(en, "", enFlat);
  const oldFlat: [string, string][] = [];
  flatten(existing, "", oldFlat);
  const done = new Map(oldFlat);

  // Ключ считается переведённым, только если он есть в старом файле и не равен
  // английскому: равное значение означает, что прошлый прогон его не осилил.
  const todo = enFlat.filter(([k, v]) => {
    const prev = done.get(k);
    return !(typeof prev === "string" && prev.trim() && prev !== v);
  });

  console.log(`en: ${enFlat.length} strings; already translated: ${enFlat.length - todo.length}; to do: ${todo.length}`);
  if (dump) {
    for (const [k, v] of todo.slice(0, 60)) console.log(`  ${k} = ${v.slice(0, 70)}`);
    return;
  }
  if (!todo.length) {
    console.log("nothing to do");
    return;
  }

  const batches: [string, string][][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  const glossary = GLOSSARY[locale] ?? "(none)";
  const translated = new Map<string, string>(
    // Старые переводы переживают прогон: пересчитываем только то, что в todo.
    oldFlat.filter(([k]) => !todo.some(([t]) => t === k)),
  );

  let nextBatch = 0;
  let failedBatches = 0;
  async function worker(id: number) {
    while (true) {
      const index = nextBatch++;
      if (index >= batches.length) return;
      const batch = batches[index];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const got = await translateBatch(batch, languageName, glossary);
          for (const [k, v] of got) translated.set(k, v);
          console.log(`[w${id}] batch ${index + 1}/${batches.length}: ${got.size}/${batch.length}`);
          break;
        } catch (e) {
          if (attempt === 3) {
            failedBatches++;
            console.error(`[w${id}] batch ${index + 1} failed: ${String(e).slice(0, 160)}`);
          } else {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const tree = rebuild(en, "", translated) as Tree;
  writeFileSync(target, `${JSON.stringify(tree, null, 2)}\n`);

  const outFlat: [string, string][] = [];
  flatten(tree, "", outFlat);
  const untouched = outFlat.filter(([k, v]) => {
    const src = enFlat.find(([ek]) => ek === k)?.[1];
    return src === v;
  });
  console.log(`wrote ${target}: ${outFlat.length} strings, ${untouched.length} still English`);
  if (failedBatches) console.log(`failed batches: ${failedBatches} — rerun to fill the gaps`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
