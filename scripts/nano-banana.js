#!/usr/bin/env node
/*
 * Nano Banana (Gemini 2.5 Flash Image) — generate or edit images.
 *
 * Usage:
 *   node scripts/nano-banana.js "<prompt>" [--in <inputImage>] [--out <outPath>]
 *
 * Reads GEMINI_API_KEY from .env (or process.env). Default model:
 *   gemini-2.5-flash-image
 *
 * Output: PNG saved to --out (default: ./nano-<timestamp>.png).
 */
const fs = require('fs');
const path = require('path');

function loadDotenv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    const v = vRaw.replace(/^["']|["']$/g, '');
    process.env[k] = v;
  }
}
loadDotenv(path.join(__dirname, '..', '.env'));

const args = process.argv.slice(2);
let prompt = null;
let inputImage = null;
let outPath = null;
let model = 'gemini-2.5-flash-image';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--in') inputImage = args[++i];
  else if (a === '--out') outPath = args[++i];
  else if (a === '--model') model = args[++i];
  else if (!prompt) prompt = a;
}
if (!prompt) {
  console.error('usage: nano-banana.js "<prompt>" [--in image.jpg] [--out out.png]');
  process.exit(1);
}
if (!outPath) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  outPath = `./nano-${ts}.png`;
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('missing GEMINI_API_KEY (put it in .env or export it)');
  process.exit(1);
}

const parts = [{ text: prompt }];
if (inputImage) {
  const data = fs.readFileSync(inputImage).toString('base64');
  const ext = path.extname(inputImage).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : 'application/octet-stream';
  parts.push({ inlineData: { mimeType, data } });
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: [{ parts }] }),
}).then(async (r) => {
  const text = await r.text();
  if (!r.ok) {
    console.error('http', r.status, text);
    process.exit(1);
  }
  const j = JSON.parse(text);
  const cand = j.candidates && j.candidates[0];
  if (!cand) { console.error('no candidates', text); process.exit(1); }
  const imgPart = (cand.content && cand.content.parts || []).find(
    (p) => p.inlineData && p.inlineData.data
  );
  if (!imgPart) {
    console.error('no image in response');
    console.error(JSON.stringify(j, null, 2));
    process.exit(1);
  }
  const buf = Buffer.from(imgPart.inlineData.data, 'base64');
  fs.writeFileSync(outPath, buf);
  console.log(outPath, buf.length);
}).catch((e) => { console.error(e); process.exit(1); });
