/**
 * Озвучка отчётов ассистента (голос — основной канал чтения у владельца).
 *
 *   node scripts/tts.mjs "текст"            /путь/отчёт.mp3
 *   node scripts/tts.mjs --file отчёт.txt   /путь/отчёт.mp3
 *   node scripts/tts.mjs -                  /путь/отчёт.mp3   # текст из stdin
 *
 * Почему ввод из файла обязателен: длинный отчёт в аргумент оболочки не отдать, и
 * 22.11.2026 это вышло наружу — вызовы шли как `tts.mjs /tmp/bw-report.txt out.mp3`,
 * а скрипт послушно **озвучивал сам путь** по-английски («tmp bw report dot txt»,
 * четыре секунды вместо отчёта). Молча. Поэтому путь, пришедший на место текста,
 * теперь либо читается как файл, либо отвергается вслух — но не произносится.
 *
 * Длинный текст режется по границам предложений: у модели потолок 4096 знаков на
 * запрос, и прежний отчёт стоял почти на нём (4 МБ ≈ 4 минуты ≈ 3900 знаков) — то
 * есть следующий чуть более длинный упал бы. Куски mp3 склеиваются подряд, как в
 * запасном `tts-gemini.mjs` склеивается PCM.
 */
import OpenAI from "openai";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_TTS_VOICE ?? "onyx";
/**
 * Интонация. Модель `gpt-4o-mini-tts` принимает `instructions` — это и есть разница
 * между диктором автоответчика и живым человеком: без них голос читает отчёт ровно,
 * одной высотой, и владелец сказал прямо — «не очень хорошее, нужен живой голос».
 * Переопределяется `OPENAI_TTS_INSTRUCTIONS` в `.env` или флагом `--style`.
 */
const INSTRUCTIONS =
  process.env.OPENAI_TTS_INSTRUCTIONS ??
  [
    "Говори по-русски как живой человек, который докладывает коллеге о работе: спокойно, уверенно, доброжелательно.",
    "Темп — чуть медленнее обычного разговорного, с ясной артикуляцией; слушают на ходу и с телефона.",
    "Держи естественную мелодику: голос идёт вниз в конце утверждения и вверх в конце вопроса.",
    "Делай короткую паузу на точке и чуть длиннее между смысловыми кусками; перечисление читай с перечислительной интонацией.",
    "Подчёркивай голосом числа, названия и слова «нашёл», «починено», «не сделано» — по ним человек ориентируется.",
    "Никакой дикторской напыщенности, спешки и монотонности. Не проглатывай окончания.",
  ].join(" ");
/** Потолок модели — 4096 знаков; запас на то, что кусок режется по предложению. */
const CHUNK = 3500;

const argv = process.argv.slice(2);
// `--style "…"` — разовая интонация поверх умолчания (например, бодрее для короткой
// новости). Вынимается из разбора до всего остального, чтобы не сдвинуть позиции.
let styleOverride = null;
const styleAt = argv.indexOf("--style");
if (styleAt >= 0) {
  styleOverride = argv[styleAt + 1] ?? null;
  argv.splice(styleAt, styleOverride === null ? 1 : 2);
}
const out = argv[argv.length - 1];
const source = argv[0] === "--file" ? { kind: "file", value: argv[1] } : { kind: "arg", value: argv[0] };

if (!source.value || !out || argv.length < 2) {
  console.error("usage: node scripts/tts.mjs [--style \"…\"] <text | --file path | -> <out.mp3>");
  process.exit(2);
}

/** Похоже на путь, а не на речь: ни одного пробела и есть расширение или такой файл есть. */
function looksLikePath(s) {
  return !/\s/.test(s) && (existsSync(s) || /\.(txt|md|json|log)$/i.test(s));
}

async function readText() {
  if (source.kind === "file") return (await readFile(source.value, "utf8")).trim();
  if (source.value === "-") {
    const parts = [];
    for await (const c of process.stdin) parts.push(c);
    return Buffer.concat(parts).toString("utf8").trim();
  }
  if (looksLikePath(source.value)) {
    if (existsSync(source.value) && statSync(source.value).isFile()) {
      console.error(`tts: аргумент — файл, читаю его как текст: ${source.value}`);
      return (await readFile(source.value, "utf8")).trim();
    }
    console.error(`tts: аргумент выглядит путём, а файла нет: ${source.value}`);
    console.error("tts: озвучивать путь вслух не стану — передайте текст или --file");
    process.exit(2);
  }
  return source.value.trim();
}

function chunks(input) {
  const parts = [];
  let current = "";
  for (const sentence of input.split(/(?<=[.!?…])\s+/)) {
    if (current && current.length + sentence.length > CHUNK) {
      parts.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const text = await readText();
if (!text) {
  console.error("tts: пустой текст");
  process.exit(2);
}

const client = new OpenAI();
const pieces = [];
for (const part of chunks(text)) {
  const r = await client.audio.speech.create({
    model: MODEL,
    voice: VOICE,
    input: part,
    instructions: styleOverride ?? INSTRUCTIONS,
    response_format: "mp3",
  });
  pieces.push(Buffer.from(await r.arrayBuffer()));
}
await writeFile(out, Buffer.concat(pieces));
console.log(out);
