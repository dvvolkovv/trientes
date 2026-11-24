"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { CardAd } from "@/lib/company-card/view";
import { AD_SLIDE_SECONDS, adSlides } from "@/lib/ads/rules";

/**
 * Баннер карточки предприятия (слайс BY) — решение владельца, два круга макетов.
 *
 * **Кадр чистый.** Поверх медиа не лежит ничего: ни текста, ни меток, ни кнопок.
 * Текст поверх фотографии нечитаем на светлом кадре, а кнопка поверх кадра отнимает у
 * кадра нажатие. Всё управление — одной полосой **под** баннером: слева точки (сколько
 * кадров и какой сейчас), справа кнопки 44 px.
 *
 * Нажатие на сам кадр ведёт **на страницу материала** (слайс BZ): кадр — самая большая
 * цель на экране, и за ним стоит всё, что с материалом можно сделать — место на карте,
 * срок события, голос, вопрос магазину, подписка. Быстрый просмотр на месте остался
 * кнопкой «подробнее»: в навигаторе человек не всегда хочет уходить с карты.
 *
 * Листание — родная прокрутка со снапом, а не свой разбор жеста: у навигатора свой
 * разбор уже есть (слайс AK), и второй внутри него спорил бы с ним за палец.
 *
 * **Кадры материала — позиции одной карусели** (слайс CE). У материала бывает до восьми
 * кадров, они идут подряд и несут его текст, голос, промокод и действие: «подробнее» на
 * любом кадре показывает один и тот же рассказ. Двух уровней листания нет осознанно —
 * точки по материалам и кадры, сами меняющиеся внутри, читались бы как дёргающийся
 * баннер.
 *
 * **Слайды сменяются сами** (слайс CB, решение владельца «до восьми, и чтобы они по
 * очереди перелистывались»), и у этого четыре границы, каждая из живого опыта:
 * карусель молчит, пока она за краем экрана (приём пульса булавки в AY); молчит при
 * `prefers-reduced-motion`; молчит, пока раскрыта описательная часть, играет ролик
 * или говорит голос — человек в этот момент читает или слушает; и **останавливается
 * навсегда**, как только человек тронул её сам. Баннер, уезжающий из-под пальца,
 * враждебен, а «подождём и поедем дальше» — это он и есть.
 */
export function AdBanner({ ads }: { ads: CardAd[] }) {
  const t = useTranslations("companyCard");
  const format = useFormatter();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Человек тронул карусель — дальше она его слушается, а не часы. */
  const [touched, setTouched] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Позиции карусели: пара «материал, кадр». Считается один раз на отрисовку —
   * второй разбор кадров в обработчике прокрутки разошёлся бы с первым.
   */
  const frames = ads.flatMap((a) =>
    adSlides(a).map((slide, i) => ({ ad: a, slide, key: `${a.id}:${i}` })),
  );
  const pos = Math.min(index, Math.max(0, frames.length - 1));
  const frame = frames[pos];
  const ad = frame?.ad ?? ads[0];

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

  /**
   * Смена позиции. Ролик и «скопировано» сбрасываются всегда, а голос замолкает
   * только при переходе **к другому материалу**: внутри одного рассказа запись
   * относится ко всем его кадрам, и глушить её на втором кадре значило бы обрывать
   * фразу на полуслове.
   */
  const changeIndex = useCallback(
    (next: number, sameAd: boolean) => {
      setIndex((prev) => {
        if (prev === next) return prev;
        if (!sameAd) stopVoice();
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
    const clamped = Math.max(0, Math.min(frames.length - 1, next));
    changeIndex(clamped, frames[clamped]?.ad.id === frames[pos]?.ad.id);
  }, [frames, pos, changeIndex]);

  const goTo = useCallback((i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  // Карусель за краем экрана не листается: на странице монеты и в навигаторе она
  // стоит ниже сгиба, и слайды уезжали бы вхолостую (тот же приём, что пульс AY).
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setOnScreen(entries[0]?.isIntersecting ?? false), {
      threshold: 0.4,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (frames.length < 2 || touched || !onScreen) return;
    if (open || playing || speaking) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const tm = setTimeout(() => goTo((index + 1) % frames.length), AD_SLIDE_SECONDS * 1000);
    return () => clearTimeout(tm);
  }, [frames.length, touched, onScreen, open, playing, speaking, index, goTo]);

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
        onPointerDown={() => setTouched(true)}
        onKeyDown={() => setTouched(true)}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-[22px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {frames.map((f, i) => (
          <div key={f.key} className="w-full shrink-0 snap-center">
            {f.slide.kind === "VIDEO" && playing && i === pos ? (
              <video
                src={f.slide.url}
                poster={f.slide.posterUrl ?? undefined}
                controls
                autoPlay
                playsInline
                className="aspect-[16/10] w-full rounded-[22px] border border-hairline bg-black object-cover"
              />
            ) : (
              <Link
                href={f.ad.href}
                data-testid="ad-banner-frame"
                aria-label={f.ad.title}
                className="block aspect-[16/10] w-full overflow-hidden rounded-[22px] border border-hairline bg-bg-tint"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.slide.kind === "VIDEO" ? (f.slide.posterUrl ?? f.slide.url) : f.slide.url}
                  alt={f.ad.title}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="h-full w-full object-cover"
                />
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Полоса управления — под баннером, и только здесь. */}
      <div className="mt-2.5 flex items-center gap-2">
        {frames.length > 1 ? (
          <div className="mr-auto flex items-center gap-1.5 pl-1" role="tablist" aria-label={t("ad.slides")}>
            {frames.map((f, i) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={i === pos}
                aria-label={t("ad.slide", { n: i + 1, total: frames.length })}
                onClick={() => { setTouched(true); goTo(i); }}
                className={`h-[7px] rounded-full transition-all ${i === pos ? "w-[18px] bg-accent" : "w-[7px] bg-card-alt"}`}
              />
            ))}
          </div>
        ) : (
          <span className="mr-auto" />
        )}

        {frame?.slide.kind === "VIDEO" && !playing ? (
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
                📅 {ad.eventEndAt && ad.eventEndAt.slice(0, 10) !== ad.eventAt.slice(0, 10)
                  ? `${day(ad.eventAt)} — ${day(ad.eventEndAt)}`
                  : day(ad.eventAt)}
              </span>
            ) : null}
            {ad.place ? (
              <span className="rounded-full border border-hairline bg-bg-tint px-2.5 py-1.5">
                📍 {ad.place.name ?? ad.place.address ?? t("ad.placeHere")}
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

          {/* Вся работа с материалом — на его странице; тут только быстрый просмотр. */}
          <Link
            href={ad.href}
            className="mt-2 flex h-12 items-center justify-center gap-2 rounded-[14px] bg-accent text-[13px] font-bold text-accent-foreground"
          >
            {t("ad.openPage")}
            <span aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
