/**
 * Голосовой набор описания — правила, которые нельзя держать в компоненте
 * (спека `docs/superpowers/specs/2026-11-18-barcode-scan-and-dictation-design.md`).
 *
 * Главное решение: надиктованное **дописывается в конец**, а поле остаётся обычным
 * полем. Распознавание не переписывает набранное и не трогает курсор: человек говорит
 * суть, потом правит её руками — иначе его собственная правка спорила бы с
 * приходящими куска́ми речи, и он терял бы текст.
 */

import { speechLang } from "@/lib/locales";

const SENTENCE_END = /[.!?…:;]$/;

/** Знаков препинания от себя не ставим: это слова человека, а не наши. */
export function appendDictated(previous: string, chunk: string): string {
  const said = chunk.replace(/\s+/g, " ").trim();
  if (!said) return previous;

  const base = previous.replace(/[ \t]+$/, "");
  if (!base) return capitalise(said);

  // Начало новой фразы пишем с большой буквы — но только если предыдущая закончена
  // точкой. Браузер отдаёт речь без заглавных не на всех языках, а дописывать их в
  // середину фразы значило бы менять смысл.
  const head = SENTENCE_END.test(base) || base.endsWith("\n") ? capitalise(said) : said;
  return base.endsWith("\n") ? `${base}${head}` : `${base} ${head}`;
}

function capitalise(text: string): string {
  const first = text[0];
  const upper = first.toUpperCase();
  // Языки без заглавных (японский, корейский) оставляем как есть.
  return upper === first ? text : `${upper}${text.slice(1)}`;
}

/**
 * Язык распознавания — язык описания паспорта, а не страницы: описание пишет мерчант на
 * своём языке (то же решение, что у озвучивания описания в `SpeakButton`).
 */
export function dictationLang(productLanguage: string): string {
  return speechLang(productLanguage);
}

/**
 * Поводы, после которых перезапускать распознавание нельзя. Safari обрывает его после
 * каждой фразы, и без перезапуска диктовка длилась бы одно предложение; но перезапуск
 * после отказа в микрофоне — это бесконечный цикл запросов разрешения.
 */
const TERMINAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

export function isTerminalSpeechError(error: string | null | undefined): boolean {
  return TERMINAL.has(error ?? "");
}

/**
 * Перезапуск только пока человек не нажал «стоп» и пока обрывы не пошли чередой: пустые
 * обрывы один за другим означают, что микрофона слушать нечего.
 */
export function shouldRestart(listening: boolean, error: string | null, silentRestarts: number): boolean {
  if (!listening) return false;
  if (isTerminalSpeechError(error)) return false;
  return silentRestarts < 4;
}
