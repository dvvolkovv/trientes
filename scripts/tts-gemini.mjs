/**
 * Запасная озвучка отчётов, когда у OpenAI кончились кредиты (живой случай 20.11.2026:
 * `insufficient_quota` на `scripts/tts.mjs`). Голос — у человека единственный канал
 * чтения, и молчать нельзя.
 *
 *   node scripts/tts-gemini.mjs "текст" /путь/отчёт.wav
 *
 * Пишет **wav**, а не mp3: `ffmpeg` и `lame` на машине нет (то же, из-за чего BB не
 * проверяет длительность видео), а тащить кодек в репозиторий ради обёртки незачем —
 * Telegram отдаёт wav как обычный файл и он проигрывается.
 *
 * Длинный текст режется на куски по границам предложений: у модели свой потолок на
 * запрос, а склейка идёт в PCM — у кусков один формат (24 кГц, 16 бит, моно).
 */
import { writeFile } from "node:fs/promises";
import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const MODEL = "gemini-2.5-flash-preview-tts";
const VOICE = process.env.GEMINI_TTS_VOICE ?? "Charon";
const CHUNK = 1200;

const text = process.argv[2];
const out = process.argv[3];
if (!text || !out) {
  console.error("usage: node scripts/tts-gemini.mjs <text> <out.wav>");
  process.exit(2);
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
        contents: [{ parts: [{ text: part }] }],
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

const pieces = [];
for (const part of chunks(text)) pieces.push(await speak(part));
await writeFile(out, wav(Buffer.concat(pieces)));
console.log(out);
