"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { CardAd } from "@/lib/company-card/view";

/**
 * Баннер карточки предприятия (слайс BY) — решение владельца, два круга макетов.
 *
 * **Кадр чистый.** Поверх медиа не лежит ничего: ни текста, ни меток, ни кнопок.
 * Текст поверх фотографии нечитаем на светлом кадре, а кнопка поверх кадра отнимает у
 * кадра нажатие. Всё управление — одной полосой **под** баннером: слева точки (сколько
 * материалов и какой сейчас), справа кнопки 44 px.
 *
 * Нажатие на сам кадр равно «подробнее»: кадр — самая большая цель на экране, и терять
 * её нельзя. Описательная часть раскрывается под баннером.
 *
 * Листание — родная прокрутка со снапом, а не свой разбор жеста: у навигатора свой
 * разбор уже есть (слайс AK), и второй внутри него спорил бы с ним за палец.
 */
export function AdBanner({ ads }: { ads: CardAd[] }) {
  const t = useTranslations("companyCard");
  const format = useFormatter();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ad = ads[Math.min(index, ads.length - 1)];

  /** Голос молчит, когда материал сменился: иначе слышно одно, а видно другое. */
  const stopVoice = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => stopVoice, [stopVoice]);

  /** Смена материала: голос замолкает, ролик и «скопировано» сбрасываются. */
  const changeIndex = useCallback(
    (next: number) => {
      setIndex((prev) => {
        if (prev === next) return prev;
        stopVoice();
        setPlaying(false);
        setCopied(false);
        return next;
      });
    },
    [stopVoice],
  );

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    changeIndex(Math.max(0, Math.min(ads.length - 1, next)));
  }, [ads.length, changeIndex]);

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  /**
   * Озвучка: своя запись сильнее синтеза. Записи нет — текст читает синтез браузера на
   * языке материала (прецедент озвучивания паспорта товара в BB). Серверного синтеза
   * не берём: платный вызов на каждый материал и каждый язык.
   */
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
    const text = [ad.title, ad.body].filter(Boolean).join(". ");
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = ad.language;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };

  /**
   * Кнопка «слушать» есть у всякого материала с текстом или записью. Умение браузера
   * читать вслух на отрисовке не спрашиваем: `window` сервер не знает, и разметка
   * двух сторон разошлась бы — живой прогон поймал ровно это. Браузер без синтеза
   * просто промолчит (ветка в `toggleVoice`).
   */
  const canSpeak = Boolean(ad.audioUrl) || Boolean(ad.body ?? ad.title);

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

  return (
    <section aria-label={t("ad.section")}>
      {/* Полотно: только медиа. Нажатие раскрывает описательную часть под ним. */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-[22px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ads.map((a, i) => (
          <div key={a.id} className="w-full shrink-0 snap-center">
            {a.mediaKind === "VIDEO" && playing && i === index ? (
              <video
                src={a.mediaUrl}
                poster={a.posterUrl ?? undefined}
                controls
                autoPlay
                playsInline
                className="aspect-[16/10] w-full rounded-[22px] border border-hairline bg-black object-cover"
              />
            ) : (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                data-testid="ad-banner-frame"
                className="block aspect-[16/10] w-full overflow-hidden rounded-[22px] border border-hairline bg-bg-tint"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.mediaKind === "VIDEO" ? (a.posterUrl ?? a.mediaUrl) : a.mediaUrl}
                  alt={a.title}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="h-full w-full object-cover"
                />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Полоса управления — под баннером, и только здесь. */}
      <div className="mt-2.5 flex items-center gap-2">
        {ads.length > 1 ? (
          <div className="mr-auto flex items-center gap-1.5 pl-1" role="tablist" aria-label={t("ad.slides")}>
            {ads.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t("ad.slide", { n: i + 1, total: ads.length })}
                onClick={() => goTo(i)}
                className={`h-[7px] rounded-full transition-all ${i === index ? "w-[18px] bg-accent" : "w-[7px] bg-card-alt"}`}
              />
            ))}
          </div>
        ) : (
          <span className="mr-auto" />
        )}

        {ad.mediaKind === "VIDEO" && !playing ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={t("ad.play")}
            className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-hairline bg-card-alt text-[15px]"
          >
            ▶
          </button>
        ) : null}

        {canSpeak ? (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={speaking ? t("ad.stopVoice") : t("ad.listen")}
            aria-pressed={speaking}
            className={`flex h-11 w-11 items-center justify-center rounded-[14px] border text-[15px] ${
              speaking ? "border-accent bg-accent text-accent-foreground" : "border-hairline bg-card-alt"
            }`}
          >
            🔊
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-11 items-center gap-2 rounded-[14px] border border-hairline bg-card-alt px-3.5 text-[12.5px] font-semibold"
        >
          {open ? t("ad.less") : t("ad.more")}
          <span aria-hidden>{open ? "⌃" : "⌄"}</span>
        </button>
      </div>

      {/* Описательная часть — под баннером, а не на нём. */}
      {open ? (
        <div className="mt-2.5 rounded-[20px] border border-hairline bg-card p-4">
          <span className="inline-flex items-center rounded-full border border-accent/45 bg-accent/12 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent">
            {t(`ad.kind.${ad.kind}`)}
          </span>
          <h3 className="mt-2.5 text-[19px] font-bold leading-tight tracking-[-0.01em]">{ad.title}</h3>
          {ad.body ? <p className="mt-1.5 whitespace-pre-line text-[13.5px] text-muted-strong">{ad.body}</p> : null}

          <div className="mt-3 flex flex-wrap gap-2 text-[11.5px] text-muted">
            {ad.eventAt ? (
              <span className="rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5">
                📅 {day(ad.eventAt)}
              </span>
            ) : null}
            {ad.endsAt ? (
              <span className="rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5">
                ⏳ {t("ad.until", { date: day(ad.endsAt) })}
              </span>
            ) : null}
            {ad.audioUrl ? (
              <span className="rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5">🔊 {t("ad.voiced")}</span>
            ) : null}
          </div>

          {ad.promoCode ? (
            <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-dashed border-accent/50 bg-accent/7 px-3 py-2.5">
              <span className="num flex-1 text-[16px] font-bold tracking-[0.08em]">{ad.promoCode}</span>
              <button
                type="button"
                onClick={copyCode}
                className="flex h-9 items-center rounded-[10px] bg-accent px-3 text-[11.5px] font-bold text-accent-foreground"
              >
                {copied ? t("ad.copied") : t("ad.copy")}
              </button>
            </div>
          ) : null}

          {ad.action ? (
            <a
              href={ad.action.href}
              {...(ad.action.kind === "WEBSITE"
                ? { target: "_blank", rel: "noopener noreferrer nofollow" }
                : {})}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-[14px] border border-hairline bg-card-alt text-[13px] font-bold"
            >
              {ad.action.kind === "PRODUCT" ? "🛍" : ad.action.kind === "POINT" ? "📍" : "🔗"}
              {t(`ad.action.${ad.action.kind}`)}
              <span aria-hidden className="text-muted">→</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
