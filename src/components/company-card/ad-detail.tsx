"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { CardAd } from "@/lib/company-card/view";

/**
 * Материал на своей странице (слайс BZ): медиа во всю ширину, текст целиком, голос и
 * промокод. Всё, что требует браузера, собрано здесь — страница вокруг остаётся
 * серверной, как и в карточке предприятия.
 *
 * Голос: своя запись сильнее синтеза (правило BY). Записи нет — читает браузер; не
 * умеет — кнопка молчит, но она есть: спрашивать `window` на отрисовке нельзя,
 * разметка сервера и браузера разошлась бы (живой прогон BY поймал ровно это).
 */
export function AdDetail({ ad }: { ad: CardAd }) {
  const t = useTranslations("companyCard");
  const ta = useTranslations("adPage");
  const format = useFormatter();
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopVoice = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => stopVoice, [stopVoice]);

  const toggleVoice = () => {
    if (speaking) {
      stopVoice();
      return;
    }
    if (ad.audioUrl) {
      const audio = new Audio(ad.audioUrl);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      audioRef.current = audio;
      void audio.play().then(() => setSpeaking(true)).catch(() => setSpeaking(false));
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance([ad.title, ad.body].filter(Boolean).join(". "));
    utter.lang = ad.language;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };

  const copyCode = async () => {
    if (!ad.promoCode) return;
    try {
      await navigator.clipboard.writeText(ad.promoCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long" });
  const eventLine = ad.eventAt
    ? ad.eventEndAt && ad.eventEndAt.slice(0, 10) !== ad.eventAt.slice(0, 10)
      ? ta("eventRange", { from: day(ad.eventAt), to: day(ad.eventEndAt) })
      : day(ad.eventAt)
    : null;

  return (
    <article className="space-y-4">
      {ad.mediaKind === "VIDEO" && playing ? (
        <video
          src={ad.mediaUrl}
          poster={ad.posterUrl ?? undefined}
          controls
          autoPlay
          playsInline
          className="aspect-[16/10] w-full rounded-[22px] border border-hairline bg-black object-cover"
        />
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ad.mediaKind === "VIDEO" ? (ad.posterUrl ?? ad.mediaUrl) : ad.mediaUrl}
            alt={ad.title}
            className="aspect-[16/10] w-full rounded-[22px] border border-hairline bg-bg-tint object-cover"
          />
          {ad.mediaKind === "VIDEO" ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={t("ad.play")}
              className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full border border-hairline bg-card/90 text-[22px]"
            >
              ▶
            </button>
          ) : null}
        </div>
      )}

      <div>
        <span className="inline-flex items-center rounded-full border border-accent/45 bg-accent/12 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent">
          {t(`ad.kind.${ad.kind}`)}
        </span>
        <h1 className="mt-2.5 text-[26px] font-bold leading-tight tracking-[-0.02em]">{ad.title}</h1>
        {ad.body ? <p className="mt-2 whitespace-pre-line text-[15px] text-muted-strong">{ad.body}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2 text-[12px] text-muted">
        {eventLine ? (
          <span className="rounded-full border border-hairline bg-bg-tint px-3 py-2">📅 {eventLine}</span>
        ) : null}
        {ad.endsAt ? (
          <span className="rounded-full border border-hairline bg-bg-tint px-3 py-2">
            ⏳ {t("ad.until", { date: day(ad.endsAt) })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleVoice}
          aria-pressed={speaking}
          className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[12.5px] font-semibold ${
            speaking ? "border-accent bg-accent text-accent-foreground" : "border-hairline bg-card-alt text-foreground"
          }`}
        >
          🔊 {speaking ? t("ad.stopVoice") : t("ad.listen")}
        </button>
      </div>

      {ad.promoCode ? (
        <div className="flex items-center gap-3 rounded-[16px] border border-dashed border-accent/50 bg-accent/7 px-4 py-3">
          <span className="num flex-1 text-[18px] font-bold tracking-[0.08em]">{ad.promoCode}</span>
          <button
            type="button"
            onClick={copyCode}
            className="flex h-10 items-center rounded-[10px] bg-accent px-4 text-[12px] font-bold text-accent-foreground"
          >
            {copied ? t("ad.copied") : t("ad.copy")}
          </button>
        </div>
      ) : null}
    </article>
  );
}
