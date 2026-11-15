"use client";

/**
 * Синтез речи для ведения по маршруту.
 *
 * Отдельный дом нужен из-за одного правила, которое легко не заметить и
 * невозможно проверить на компьютере: **первый** `speak()` обязан случиться
 * внутри жеста человека. Иначе мобильный Safari молча ничего не произносит —
 * без ошибки, без события, просто тишина. Ровно это и было: первая фраза шла
 * из колбэка геолокации, и голос не работал ни разу ни у кого с айфона.
 */

let unlocked = false;
let keepAlive: ReturnType<typeof setInterval> | null = null;

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Теги голосов пишут и через дефис, и через подчёркивание, и в любом регистре. */
function normalizeTag(tag: string): string {
  return tag.replace(/_/g, "-").toLowerCase();
}

export type VoiceLike = { lang: string; localService: boolean; name: string };

/**
 * Какой голос читает подсказки.
 *
 * Точный тег важнее семьи: `pt-BR` и `pt-PT` — разные языки для уха, и
 * бразильцу читать лиссабонским голосом так же неуютно, как наоборот.
 * Встроенный голос важнее сетевого: в дороге связь пропадает именно там, где
 * подсказка нужнее всего. Чужой язык не подставляется никогда — турецкий голос
 * вместо хорватского хуже молчания.
 */
export function pickSpeechVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  if (!voices.length) return null;
  const want = normalizeTag(lang);
  const family = want.slice(0, 2);
  const exact = voices.filter((v) => normalizeTag(v.lang) === want);
  const same = voices.filter((v) => normalizeTag(v.lang).startsWith(family));
  for (const pool of [exact, same]) {
    const local = pool.find((v) => v.localService);
    if (local) return local;
    if (pool.length) return pool[0];
  }
  return null;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  return pickSpeechVoice(window.speechSynthesis.getVoices(), lang);
}

function utter(text: string, lang: string): void {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  // Голый двухбуквенный код iOS понимает как «любой голос»: иногда берёт
  // чужой язык, иногда не берёт никакого. Голос выбирается здесь.
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.rate = 1;
  u.onend = stopKeepAlive;
  u.onerror = stopKeepAlive;
  window.speechSynthesis.speak(u);
  startKeepAlive();
}

// Chrome ставит синтез на паузу примерно через пятнадцать секунд и сам его не
// снимает. Пока что-то произносится, дёргаем `resume()`.
function startKeepAlive(): void {
  if (keepAlive) return;
  keepAlive = setInterval(() => {
    if (!speechAvailable() || !window.speechSynthesis.speaking) {
      stopKeepAlive();
      return;
    }
    window.speechSynthesis.resume();
  }, 5000);
}

function stopKeepAlive(): void {
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
}

/**
 * Отпереть синтез. Вызывать **синхронно из обработчика нажатия**, до любого
 * `await`: жест кончается на первом же уходе в микрозадачу.
 */
export function primeVoice(text: string, lang: string): void {
  if (!speechAvailable()) return;
  if (unlocked) return;
  unlocked = true;
  try {
    utter(text, lang);
  } catch {
    // браузер объявил API, но говорить отказался
  }
}

/** Отперт ли синтез — пока нет, фразы ведения произносить бессмысленно. */
export function voiceUnlocked(): boolean {
  return unlocked;
}

/**
 * Сказать фразу ведения. Недоговорённое отменяется: в движении последняя
 * подсказка всегда важнее предыдущей.
 */
export function speakNav(text: string, lang: string): void {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
    utter(text, lang);
  } catch {
    // см. выше
  }
}

export function cancelSpeech(): void {
  if (!speechAvailable()) return;
  stopKeepAlive();
  try {
    window.speechSynthesis.cancel();
  } catch {
    // см. выше
  }
}
