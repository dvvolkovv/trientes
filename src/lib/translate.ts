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
};

// English (and any locale we don't translate to) returns null → caller serves the source.
export function targetLanguageName(locale: string): string | null {
  return LANG_NAMES[locale] ?? null;
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
