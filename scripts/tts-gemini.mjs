/**
 * Запасная озвучка отчётов, когда у OpenAI кончились кредиты (живой случай 20.11.2026:
 * `insufficient_quota` на `scripts/tts.mjs`). Голос — у человека единственный канал
 * чтения, и молчать нельзя.
 *
 *   node scripts/tts-gemini.mjs "текст"           /путь/отчёт.wav
 *   node scripts/tts-gemini.mjs --file отчёт.txt   /путь/отчёт.wav
 *   node scripts/tts-gemini.mjs -                  /путь/отчёт.wav   # из stdin
 *
 * Пишет **wav**, а не mp3: `ffmpeg` и `lame` на машине нет (то же, из-за чего BB не
 * проверяет длительность видео), а тащить кодек в репозиторий ради обёртки незачем —
 * Telegram отдаёт wav как обычный файл и он проигрывается.
 *
 * Длинный текст режется на куски по границам предложений: у модели свой потолок на
 * запрос, а склейка идёт в PCM — у кусков один формат (24 кГц, 16 бит, моно).
 *
 * Текст уходит **с рамкой** («Прочитай вслух … :»): с 22.11.2026 модель принимает голый
 * текст за указание себе и отвечает `400 Model tried to generate text, but it should
 * only be used for TTS`. Сама рамка не произносится — это указание стиля, проверено
 * расшифровкой. Модель оставлена на `2.5-flash-preview-tts`: она отдаёт голый PCM, под
 * который здесь пишется заголовок WAV, а новая `gemini-3.8-flash-tts` отдаёт уже
 * готовый wav — склейка кусков с заголовком посередине дала бы битый файл.
 */
import { writeFile, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const MODEL = "gemini-2.5-flash-preview-tts";
const VOICE = process.env.GEMINI_TTS_VOICE ?? "Charon";
const CHUNK = 1200;
const FRAME = "Прочитай вслух, спокойно и дружелюбно, на языке текста: ";

const argv = process.argv.slice(2);
const out = argv[argv.length - 1];
const source = argv[0] === "--file" ? { kind: "file", value: argv[1] } : { kind: "arg", value: argv[0] };
if (!source.value || !out || argv.length < 2) {
  console.error("usage: node scripts/tts-gemini.mjs <text | --file path | -> <out.wav>");
  process.exit(2);
}

/**
 * Путь, пришедший на место текста, озвучивать нельзя. 22.11.2026 этот капкан сработал
 * у `tts.mjs`: отчёты звали его как `tts.mjs /tmp/bw-report.txt out.mp3`, и владелец
 * четыре секунды слушал по-английски «tmp bw report dot txt» вместо отчёта. Правило
 * общее для обоих скриптов — файл читаем, несуществующий путь отвергаем вслух.
 */
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
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY not set");
  process.exit(2);
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

async function speak(part) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${FRAME}${part}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
      // Свой срок: у чужого вызова его нет по умолчанию (правило уборки BH).
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) throw new Error(`gemini tts ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const inline = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error(`gemini tts: no audio in response`);
  return Buffer.from(inline.data, "base64");
}

/** Заголовок WAV пишем сами: модель отдаёт голый PCM (`audio/L16;rate=24000`). */
function wav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // моно
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const text = await readText();
if (!text) {
  console.error("tts: пустой текст");
  process.exit(2);
}

const pieces = [];
for (const part of chunks(text)) pieces.push(await speak(part));
await writeFile(out, wav(Buffer.concat(pieces)));
console.log(out);
