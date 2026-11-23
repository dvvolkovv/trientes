/**
 * Озвучка рекламного материала нашим синтезом (слайс BZ).
 *
 * Слайс BY отказал серверному синтезу — «платный вызов на каждый материал и каждый
 * язык». Решение владельца этот отказ отменяет, но платим мы по-прежнему не за показ:
 * запись делается **один раз в студии** и дальше это обычный mp3, который отдаёт
 * nginx. То есть цена — по одной на материал, а не по одной на посетителя.
 *
 * Интонация — та же выделка, что у голосовых отчётов (`scripts/tts.mjs`): модель
 * `gpt-4o-mini-tts` принимает `instructions`, и без них голос читает ровно, одной
 * высотой. Браузерный `speechSynthesis` остаётся запасным путём там, где записи нет.
 */

import { AD_BODY_MAX, type AdVoice, type AdVoiceStyle } from "@/lib/ads/rules";

const API = "https://api.openai.com/v1/audio/speech";
const MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
/** Запись короткая, но модель считает её целиком — срок щедрее обычных восьми секунд. */
const TIMEOUT_MS = 60_000;

/** Манера чтения словами. Выбор продавца, а не наша догадка по виду материала. */
const STYLE: Record<AdVoiceStyle, string> = {
  calm: "Спокойно, доброжелательно и ясно, как говорит продавец, которому доверяют. Без нажима и без спешки.",
  bright: "Бодро и тепло, с лёгкой улыбкой в голосе, как хорошая новость. Живой темп, но без тараторенья.",
  solemn: "Торжественно и неторопливо, с уважением к слушателю, как приглашение на важное событие.",
};

const COMMON = [
  "Читай текст объявления так, как его прочитал бы живой человек вслух, а не диктор автоответчика.",
  "Держи естественную мелодику: вниз в конце утверждения, вверх в конце вопроса.",
  "Короткая пауза на точке, чуть длиннее между смысловыми кусками.",
  "Числа, названия и цену произноси отчётливо — ради них текст и слушают.",
  "Ничего не добавляй от себя и не читай служебных пометок.",
].join(" ");

export type VoiceResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "not_configured" | "too_long" | "empty" | "upstream" | "timeout" };

/** Текст, который слышит человек: заголовок и тело — то же, что читает браузерный синтез. */
export function adSpeechText(title: string, body: string | null | undefined): string {
  return [title.trim(), (body ?? "").trim()].filter(Boolean).join(". ");
}

export async function synthesizeAdVoice(input: {
  title: string;
  body: string | null | undefined;
  voice: AdVoice;
  style: AdVoiceStyle;
  /** Язык материала — в подсказке моделью он слышен лучше, чем угадан по буквам. */
  language: string;
  fetchImpl?: typeof fetch;
}): Promise<VoiceResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured" };

  const text = adSpeechText(input.title, input.body);
  if (!text) return { ok: false, reason: "empty" };
  // Потолок текста тот же, что у самого материала: длинную рекламу не дослушивают.
  if (text.length > AD_TEXT_LIMIT) return { ok: false, reason: "too_long" };

  const instructions = `${COMMON} ${STYLE[input.style]} Язык текста: ${input.language}.`;
  const call = input.fetchImpl ?? fetch;

  try {
    const res = await call(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        voice: input.voice,
        input: text,
        instructions,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "upstream" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return { ok: false, reason: "upstream" };
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "upstream" };
  }
}

/** Заголовок и тело вместе: та же граница, что у текста материала, плюс точка с пробелом. */
const AD_TEXT_LIMIT = AD_BODY_MAX + 120;
