"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { appendDictated, dictationLang, isTerminalSpeechError, shouldRestart } from "@/lib/dictation";

/**
 * Голосовой набор текста в поле паспорта.
 *
 * Распознавание браузерное (`webkitSpeechRecognition`), как и озвучивание в
 * `SpeakButton`: серверное значило бы платный вызов на каждую фразу каждого мерчанта.
 * Нет распознавания в браузере — кнопки нет вовсе.
 *
 * Надиктованное **дописывается в конец**, поле остаётся обычным полем, и правка руками
 * идёт поверх: правила — в `src/lib/dictation.ts`, потому что их надо было накрыть
 * тестом. Промежуточная догадка речи показывается серым **под полем**, а не в самом
 * поле: иначе она затирала бы то, что человек правит в эту же секунду.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function DictateButton({
  language,
  value,
  onChange,
}: {
  /** Язык описания из паспорта, а не локаль страницы. */
  language: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTranslations("dictation");
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const engine = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const silent = useRef(0);
  // Повод отказа — ссылкой: обработчик `onend` создан один раз, и состояние в нём
  // осталось бы тем, каким было при нажатии, то есть пустым.
  const fatal = useRef<string | null>(null);
  // Текст и приёмник держим ссылками: обработчики речи живут дольше одной отрисовки.
  const latest = useRef(value);
  latest.current = value;
  const apply = useRef(onChange);
  apply.current = onChange;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && recognitionCtor() !== null);
    return () => {
      wanted.current = false;
      engine.current?.abort();
    };
  }, []);

  if (!supported) return null;

  const stop = () => {
    wanted.current = false;
    setListening(false);
    setInterim("");
    engine.current?.stop();
  };

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    engine.current = rec;
    rec.lang = dictationLang(language);
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const said = result[0].transcript;
        if (result.isFinal) {
          silent.current = 0;
          apply.current(appendDictated(latest.current, said));
        } else {
          pending += said;
        }
      }
      setInterim(pending);
    };

    rec.onerror = (event) => {
      const code = event.error ?? "failed";
      // «Ничего не сказано» — не беда, а тишина: об этом не кричим, просто слушаем снова.
      if (code === "no-speech" || code === "aborted") {
        silent.current += 1;
        return;
      }
      const terminal = isTerminalSpeechError(code);
      fatal.current = terminal ? code : null;
      setError(terminal ? code : "failed");
      if (terminal) {
        wanted.current = false;
        setListening(false);
        setInterim("");
      }
    };

    rec.onend = () => {
      setInterim("");
      // Safari обрывает распознавание после каждой фразы — без перезапуска диктовка
      // кончалась бы на первом предложении.
      if (shouldRestart(wanted.current, fatal.current, silent.current)) {
        try {
          rec.start();
          return;
        } catch {
          // Движок ещё не отпустил микрофон — считаем это концом диктовки.
        }
      }
      wanted.current = false;
      setListening(false);
    };

    try {
      rec.start();
      wanted.current = true;
      silent.current = 0;
      fatal.current = null;
      setError(null);
      setListening(true);
    } catch {
      setError("failed");
    }
  };

  return (
    <span className="block space-y-1">
      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        aria-pressed={listening}
        className={`h-12 px-4 rounded-md border text-sm font-medium flex items-center gap-2 ${
          listening ? "border-accent text-accent" : "border-hairline hover:border-accent"
        }`}
      >
        <span aria-hidden>{listening ? "⏹" : "🎙"}</span>
        {listening ? t("stop") : t("start")}
      </button>
      {listening ? <span className="block text-[11px] text-muted">{interim ? interim : t("listening")}</span> : null}
      {!listening && error ? <span className="block text-[11px] text-red-500">{t(`error.${error}`)}</span> : null}
      {listening ? null : <span className="block text-[11px] text-muted">{t("hint")}</span>}
    </span>
  );
}
