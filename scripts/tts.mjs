import OpenAI from "openai";
import { writeFile } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
loadEnv({ path: new URL("../.env", import.meta.url).pathname });
const client = new OpenAI();
const text = process.argv[2];
const out = process.argv[3];
const r = await client.audio.speech.create({
  model: "gpt-4o-mini-tts",
  voice: "onyx",
  input: text,
  response_format: "mp3",
});
const buf = Buffer.from(await r.arrayBuffer());
await writeFile(out, buf);
console.log(out);
