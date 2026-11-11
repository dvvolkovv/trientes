// Machine-translate the visible text of a small HTML fragment via OpenAI, preserving
// tags and links. Best-effort: returns null on any failure (no key, timeout, bad response).

const LANG_NAMES: Record<string, string> = {
  ru: "Russian",
  de: "German",
  es: "Spanish",
  fr: "French",
  ja: "Japanese",
  ko: "Korean",
  "pt-BR": "Brazilian Portuguese",
  tr: "Turkish",
  "zh-CN": "Simplified Chinese",
  hr: "Croatian",
};

// English (and any locale we don't translate to) returns null → caller serves the source.
// Это контракт фида CoinGecko: там английский и есть источник.
export function targetLanguageName(locale: string): string | null {
  return LANG_NAMES[locale] ?? null;
}

// Для пользовательской прозы источником может быть любой язык, поэтому
// английский здесь — такая же цель перевода, как остальные.
const PROSE_LANG_NAMES: Record<string, string> = { ...LANG_NAMES, en: "English" };

export function proseLanguageName(locale: string): string | null {
  return PROSE_LANG_NAMES[locale] ?? null;
}

export async function translateHtml(
  html: string,
  locale: string,
  timeoutMs = 12000,
): Promise<string | null> {
  const lang = LANG_NAMES[locale];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!lang || !apiKey || !html) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              `Translate the visible text of the HTML the user sends into ${lang}. ` +
              "Keep every HTML tag, attribute and URL exactly as-is — translate only human-readable text. " +
              "Do not add, remove or reorder tags. Output only the translated HTML, with no code fences or commentary.",
          },
          { role: "user", content: html },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content?.trim();
    return out && out.length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Перевод значений JSON-объекта одним запросом: шесть полей карточки — это один
 * вызов и один кеш, а не шесть. Ключи сохраняются; то, чего модель не вернула,
 * вызывающая сторона оставит оригинальным.
 *
 * Отдельно от translateHtml: проза карточки хранится обычным текстом (она
 * рендерится через whitespace-pre-line, а не dangerouslySetInnerHTML — защита
 * от stored XSS), и промпт про сохранение тегов провоцировал бы разметку.
 */
export async function translateStrings(
  fields: Record<string, string>,
  locale: string,
  timeoutMs = 20000,
): Promise<Record<string, string> | null> {
  const lang = PROSE_LANG_NAMES[locale];
  const apiKey = process.env.OPENAI_API_KEY;
  const keys = Object.keys(fields);
  if (!lang || !apiKey || keys.length === 0) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Translate every string value of the JSON object the user sends into ${lang}. ` +
              "Keep the keys exactly as given. Keep URLs, ticker symbols, chain names, " +
              "contract addresses, product names and numbers unchanged. " +
              "Preserve line breaks. Output only a JSON object with the same keys.",
          },
          { role: "user", content: JSON.stringify(fields) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    // Берём только те ключи, что просили: лишнее от модели игнорируется.
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Язык, на котором написан текст — одним запросом и строго из списка наших
 * локалей. Нужен потому, что переводить текст в его же язык бессмысленно, а
 * источник у пользовательской прозы заранее неизвестен.
 */
export async function detectSourceLocale(
  text: string,
  timeoutMs = 12000,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const sample = (text ?? "").trim().slice(0, 1200);
  if (!apiKey || !sample) return null;
  const allowed = Object.keys(PROSE_LANG_NAMES);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Identify the language of the user text. Answer with exactly one code from " +
              `this list and nothing else: ${allowed.join(", ")}. ` +
              "If the language is not in the list, answer: none",
          },
          { role: "user", content: sample },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content?.trim();
    if (!out) return null;
    const hit = allowed.find((l) => l.toLowerCase() === out.toLowerCase());
    return hit ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
