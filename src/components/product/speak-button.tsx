"use client";

import { useEffect, useState } from "react";

/**
 * Прослушивание описания голосом. Синтез — браузерный (`speechSynthesis`), а не наш
 * серверный: серверный значил бы платный вызов на каждый товар и каждый язык плюс
 * хранение и гашение записи при каждой правке описания. Цена решения честная: качество
 * голоса зависит от устройства.
 *
 * Язык берётся из паспорта, а не из страницы: описание написано мерчантом на своём
 * языке, и читать его голосом другого языка — каша. Нет голоса под этот язык — кнопки
 * нет вовсе, а не «нажал и тишина».
 */
export function SpeakButton({ text, lang, label, stopLabel }: { text: string; lang: string; label: string; stopLabel: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const check = () => {
      const voices = window.speechSynthesis.getVoices();
      // Голоса приходят не сразу: до события список бывает пуст, и тогда вопрос «есть ли
      // голос» ещё не решён — кнопку рисуем только когда ответ известен.
      if (voices.length === 0) return;
      setSupported(voices.some((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase())));
    };
    check();
    window.speechSynthesis.addEventListener("voiceschanged", check);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", check);
      window.speechSynthesis.cancel();
    };
  }, [lang]);

  if (!supported) return null;

  const speak = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
    u.lang = lang;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (voice) u.voice = voice;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  return (
    <button
      type="button"
      onClick={speak}
      aria-pressed={speaking}
      className="h-12 px-4 rounded-md border border-hairline text-sm font-medium flex items-center gap-2 hover:border-accent"
    >
      <span aria-hidden>{speaking ? "⏹" : "🔊"}</span>
      {speaking ? stopLabel : label}
    </button>
  );
}
