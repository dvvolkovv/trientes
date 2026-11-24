"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createAd, updateAd } from "@/app/actions/company-ads";
import {
  AD_BODY_MAX,
  AD_KINDS,
  AD_ACTIONS,
  MAX_AD_SLIDES,
  adTextHash,
  type AdInput,
  type AdSlide,
} from "@/lib/ads/rules";
import { SUPPORTED_LOCALES } from "@/lib/locales";
import { AdPlaceField } from "@/components/ads/ad-place-field";
import { AdBanner } from "@/components/company-card/ad-banner";
import type { CardAd } from "@/lib/company-card/view";
import { AdVoiceField } from "@/components/ads/ad-voice-field";
import type { PickerCoin } from "@/components/business/coin-picker";

export type AdFormValues = AdInput & { id?: string };

const EMPTY: AdFormValues = {
  kind: "PROMO", title: "", body: "", language: "en",
  mediaKind: "IMAGE", mediaUrl: "", posterUrl: "", slides: [], audioUrl: "",
  audioGenerated: false, audioVoice: "", audioTextHash: "",
  promoCode: "", startsAt: "", endsAt: "", eventAt: "", eventEndAt: "",
  placeName: "", placeAddress: "", placeLat: null, placeLon: null,
  placeAcceptedCoinIds: [], placeAcceptedCardIds: [], placePaymentMethods: [],
  action: "NONE", productId: "", pointId: "", actionUrl: "",
};

/**
 * Заведение и правка рекламного материала (слайс BY).
 *
 * Медиа грузится до сохранения: без кадра материала не бывает, а кадр — это файл,
 * который должен лежать у нас (чужой адрес исчезнет в день, когда его уберут).
 * Ссылок в тексте нет, и под полем так и сказано: текст читает голос.
 *
 * **Кадров до восьми, и добавляются они пачкой** (слайс CE, просьба владельца). Поле
 * принимает мульти-выбор, новые кадры встают в конец, порядок правится словами
 * «выше/ниже» (голые значки — та же жалоба, что в AN), а обложкой служит первый кадр:
 * второго автора у обложки нет.
 */
export function AdForm({
  companyId,
  initial,
  editMode = "direct",
  points,
  products,
  defaultLanguage,
  coins,
  cards,
  countryCode = null,
}: {
  companyId: string;
  initial?: AdFormValues | null;
  /**
   * Как ложится правка (слайс CC): `direct` — сразу в материал, `proposal` —
   * слепком на проверку, а в карусели остаётся прежний, уже одобренный.
   */
  editMode?: "direct" | "frozen" | "proposal";
  points: { id: string; label: string }[];
  products: { id: string; label: string }[];
  defaultLanguage: string;
  /** Монеты для места материала (BZ): тот же каталог, что в форме точки. */
  coins: PickerCoin[];
  cards: PickerCoin[];
  /** Страна предприятия — подсказка геокодеру места (см. `AdPlaceField`). */
  countryCode?: string | null;
}) {
  const t = useTranslations("cabinetAds");
  const router = useRouter();
  const [v, setV] = useState<AdFormValues>(initial ?? { ...EMPTY, language: defaultLanguage });
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Блок «Где это» раскрыт, когда место уже есть или когда действие ведёт на него:
  // выбор «вести на место материала» обязан показать поля адреса, а не отправить
  // человека искать их глазами выше по форме.
  const [placeOpen, setPlaceOpen] = useState(
    typeof (initial?.placeLat ?? null) === "number" && typeof (initial?.placeLon ?? null) === "number",
  );
  const placeRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const posterRef = useRef<HTMLInputElement | null>(null);
  /** Какому кадру грузится заставка: у ролика она своя, одна общая врала бы. */
  const [posterFor, setPosterFor] = useState<number | null>(null);
  /**
   * Показанный кадр (слайс CF). Одно число на предпросмотр и на правку: «правлю то,
   * на что смотрю» — иначе человек удаляет не тот кадр, который видит.
   */
  const [cur, setCur] = useState(0);


  const set = (patch: Partial<AdFormValues>) => setV((prev) => ({ ...prev, ...patch }));

  const slides: AdSlide[] = (v.slides ?? [])
    .map((s): AdSlide => ({
      // Вид — из расширения файла, как на сервере: второе правило разошлось бы.
      kind: /\.mp4$/i.test(s.url ?? "") ? "VIDEO" : "IMAGE",
      url: s.url ?? "",
      posterUrl: s.posterUrl ?? null,
    }))
    .filter((s) => s.url);

  /**
   * Кадры и обложка пишутся одним движением: обложка — первый кадр, и второй автор у
   * неё разошёлся бы с первым в тот же день (решение CE).
   */
  const setSlides = (next: AdSlide[]) => {
    const first = next[0];
    set({
      slides: next,
      mediaUrl: first?.url ?? "",
      mediaKind: first?.kind ?? "IMAGE",
      posterUrl: first?.posterUrl ?? "",
    });
  };

  const moveSlide = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const next = slides.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setSlides(next);
    // Выбор идёт за кадром, а не остаётся на месте: человек переставляет именно тот
    // кадр, на который смотрит, и смотреть он должен на него же.
    setCur(j);
  };

  /**
   * Кадр убирается из списка, а файл с диска не стирается: он мог уже уйти в слепок
   * правки, который ждёт модератора.
   */
  const dropSlide = (i: number) => {
    setSlides(slides.filter((_, k) => k !== i));
    setCur(Math.max(0, Math.min(i, slides.length - 2)));
  };

  const slidesFull = slides.length >= MAX_AD_SLIDES;

  // `min-w-0`: у элемента сетки ширина по содержимому, и список с длинным
  // названием товара растягивал бы колонку шире окна (жалоба владельца про поля,
  // которые ездят вправо-влево).
  const field = "w-full min-w-0 rounded-md border border-hairline bg-card px-3 py-2 text-sm";
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";
  const label = "mb-1 block text-[11px] uppercase tracking-wider text-muted";

  /**
   * Загрузка пачкой: один запрос на все выбранные файлы (слайс CE). `target` говорит,
   * куда лёг ответ — в кадры, в заставку кадра или в звук материала.
   */
  const upload = async (
    slot: "image" | "video" | "audio",
    files: File[],
    target: "slides" | "audio" | { poster: number },
  ) => {
    if (files.length === 0) return;
    // Пачка, которая не влезает, отвергается **до** загрузки: взять часть и
    // промолчать о второй половине — молчаливая потеря кадров (поймано живым
    // прогоном CE), а грузить файлы, которым не найдётся места, значит оставлять
    // на диске мусор.
    if (target === "slides" && slides.length + files.length > MAX_AD_SLIDES) {
      setError("slides_too_many");
      return;
    }
    setUploading(typeof target === "object" ? `poster:${target.poster}` : target);
    setError(null);
    try {
      const form = new FormData();
      form.set("companyId", companyId);
      form.set("slot", slot);
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/ads/media/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; url?: string; urls?: string[]; error?: string }
        | null;
      const urls = data?.urls ?? (data?.url ? [data.url] : []);
      if (!res.ok || !data?.ok || urls.length === 0) {
        setError(data?.error ?? "upload_failed");
        return;
      }
      if (target === "slides") {
        const added: AdSlide[] = urls.map((url) => ({
          kind: slot === "video" ? "VIDEO" : "IMAGE",
          url,
          posterUrl: null,
        }));
        setSlides([...slides, ...added]);
        // Показываем первый из добавленных: человек должен увидеть, что он загрузил.
        setCur(slides.length);
      } else if (target === "audio") {
        set({ audioUrl: urls[0], audioGenerated: false, audioVoice: "", audioTextHash: "" });
      } else {
        const next = slides.slice();
        if (next[target.poster]) next[target.poster] = { ...next[target.poster], posterUrl: urls[0] };
        setSlides(next);
      }
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(null);
    }
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const res = v.id ? await updateAd(v.id, v) : await createAd(companyId, v);
      if (!res.ok) {
        setError(res.reason);
        // Отказ стоит над кнопкой, и на длинной форме его можно не заметить вовсе:
        // человек жмёт второй раз и решает, что кнопка не работает.
        requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
        return;
      }
      if (!v.id) setV({ ...EMPTY, language: defaultLanguage });
      router.push(`?`);
      router.refresh();
    });
  };

  const hasPlace = typeof v.placeLat === "number" && typeof v.placeLon === "number";
  const placeLine = [v.placeName, v.placeAddress].filter(Boolean).join(", ").trim();

  const missing: string[] = [];
  if (slides.length === 0) missing.push(t("missing.media"));
  if (!v.title.trim()) missing.push(t("missing.title"));
  if (v.kind === "EVENT" && !(v.eventAt ?? "").trim()) missing.push(t("missing.event"));
  if (v.action === "PRODUCT" && !(v.productId ?? "").trim()) missing.push(t("missing.product"));
  if (v.action === "WEBSITE" && !(v.actionUrl ?? "").trim()) missing.push(t("missing.url"));
  if (v.action === "POINT" && !(v.pointId ?? "").trim() && !hasPlace) missing.push(t("missing.place"));

  /**
   * Предпросмотр (слайс CB, просьба владельца «посмотреть и послушать до
   * публикации»). Рисует его **тот же** компонент, что и живую карточку: второй
   * «как это будет выглядеть» разошёлся бы с настоящим — болезнь, уже стоившая
   * проекту двух сборок одной витрины (живой прогон BX).
   *
   * Кадр ведёт в никуда (`#`): у несохранённого материала страницы ещё нет, а
   * уводить человека из формы посреди набора нельзя.
   */
  const previewAd: CardAd | null = slides.length > 0
    ? {
        id: v.id ?? "preview",
        kind: (AD_KINDS.find((k) => k === v.kind) ?? "PROMO"),
        title: v.title.trim() || t("previewNoTitle"),
        body: (v.body ?? "").trim() || null,
        language: v.language,
        mediaKind: slides[0].kind,
        mediaUrl: slides[0].url,
        posterUrl: slides[0].posterUrl,
        slides,
        audioUrl: (v.audioUrl ?? "") || null,
        promoCode: (v.promoCode ?? "").trim() || null,
        endsAt: (v.endsAt ?? "") ? `${v.endsAt}T00:00:00.000Z` : null,
        eventAt: (v.eventAt ?? "") ? `${v.eventAt}T00:00:00.000Z` : null,
        eventEndAt: (v.eventEndAt ?? "") ? `${v.eventEndAt}T00:00:00.000Z` : null,
        place: hasPlace
          ? {
              name: (v.placeName ?? "").trim() || null,
              address: (v.placeAddress ?? "").trim() || null,
              lat: Number(v.placeLat),
              lon: Number(v.placeLon),
              coins: [],
              payments: [],
            }
          : null,
        documents: [],
        href: "#",
        action: null,
      }
    : null;

  return (
    <section className="mb-8 rounded-[18px] border border-hairline bg-card p-4">
      <h2 className="mb-3 text-[16px] font-semibold">{v.id ? t("editTitle") : t("newTitle")}</h2>

      <div className="space-y-3">
        {/*
          Баннер и его кадры — одним блоком и **первым** (слайс CF, просьба владельца
          «прямо под баннером, не гонять снизу доверху»). Прежде кадры правились наверху
          формы, а предпросмотр стоял в самом низу: человек смотрел на одно, а правил
          другое, через всю форму.

          Рисует предпросмотр **тот же** компонент, что и живую карточку: второй «как это
          будет выглядеть» разошёлся бы с настоящим (болезнь двух сборок одной витрины,
          живой прогон BX). Номер кадра — один на баннер и на правку, поэтому баннер
          здесь управляемый, а часы кадры не листают: в студии правят, и уезжающий
          из-под пальца кадр враждебен.
        */}
        <div className="rounded-[18px] border border-hairline bg-bg-tint p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={`${label} mb-0`}>{t("previewTitle")}</span>
            <span className="text-[11px] text-muted">{t("previewHint")}</span>
          </div>

          {previewAd ? (
            <AdBanner
              ads={[previewAd]}
              activeIndex={Math.min(cur, Math.max(0, slides.length - 1))}
              onActiveIndexChange={setCur}
              autoAdvance={false}
            />
          ) : (
            <div className="flex aspect-[16/10] w-full items-center justify-center rounded-[22px] border border-dashed border-hairline bg-card px-6 text-center text-[12.5px] leading-snug text-muted">
              {t("mediaEmpty")}
            </div>
          )}

          {/* Лента кадров: нажатие выбирает кадр, и баннер едет к нему. Только выбор —
              добавление стоит ниже, в видимом ряду (см. разбор там же). */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {slides.map((s, i) => (
              <button
                key={`${s.url}:${i}`}
                type="button"
                aria-pressed={i === cur}
                aria-label={t("slideNo", { n: i + 1, total: slides.length })}
                onClick={() => setCur(i)}
                className={`relative h-[54px] w-[86px] shrink-0 overflow-hidden rounded-[10px] border-2 bg-bg-tint ${
                  i === cur ? "border-accent" : "border-hairline"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.kind === "VIDEO" ? (s.posterUrl ?? "/logo.png") : s.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {s.kind === "VIDEO" ? (
                  <span aria-hidden className="absolute left-1 top-1 rounded bg-card/85 px-1 text-[10px] leading-tight">▶</span>
                ) : null}
                {i === 0 ? (
                  <span className="absolute inset-x-0 bottom-0 bg-card/85 text-center text-[9px] uppercase tracking-wider text-accent">
                    {t("coverBadge")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {slides.length > 0 ? (
            <div className="mt-2 text-[11.5px] leading-snug text-muted">
              {t("slideNo", { n: Math.min(cur, slides.length - 1) + 1, total: slides.length })}
              {cur === 0 ? ` · ${t("slideCover")}` : ""}
            </div>
          ) : null}

          {/*
            Один видимый ряд: сперва «добавить», потом действия над показанным кадром.
            Добавление **не** живёт в ленте: при пяти кадрах плитка «плюс» уезжает за
            правый край, и самое частое действие пришлось бы искать прокруткой (поймано
            живым прогоном CF).
          */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => imageRef.current?.click()}
              disabled={uploading !== null || slidesFull}
              className="h-11 rounded-[10px] border border-hairline bg-card px-3 text-[12px] font-semibold disabled:opacity-40">
              {uploading === "slides" ? "…" : `+ ${t("slideImage")}`}
            </button>
            <button type="button" onClick={() => videoRef.current?.click()}
              disabled={uploading !== null || slidesFull}
              className="h-11 rounded-[10px] border border-hairline bg-card px-3 text-[12px] font-semibold disabled:opacity-40">
              + {t("slideVideo")}
            </button>
            {slides.length > 0 ? (
              <>
                <button type="button" onClick={() => moveSlide(cur, -1)} disabled={cur === 0}
                  className="h-11 rounded-[10px] border border-hairline px-3 text-[12px] disabled:opacity-40">
                  ← {t("slideLeft")}
                </button>
                <button type="button" onClick={() => moveSlide(cur, 1)} disabled={cur >= slides.length - 1}
                  className="h-11 rounded-[10px] border border-hairline px-3 text-[12px] disabled:opacity-40">
                  {t("slideRight")} →
                </button>
                {slides[cur]?.kind === "VIDEO" ? (
                  <button type="button" onClick={() => { setPosterFor(cur); posterRef.current?.click(); }}
                    disabled={uploading !== null}
                    className="h-11 rounded-[10px] border border-hairline px-3 text-[12px] disabled:opacity-40">
                    {uploading === `poster:${cur}` ? "…" : t("uploadPoster")}
                  </button>
                ) : null}
                <button type="button" onClick={() => dropSlide(cur)}
                  className="h-11 rounded-[10px] border border-[#E55C5C]/50 px-3 text-[12px] text-[#E55C5C]">
                  ✕ {t("slideRemove")}
                </button>
              </>
            ) : null}
          </div>

          {/* Кнопка, погасшая без объяснения, уже была дефектом живого прогона BG. */}
          {slidesFull ? (
            <p className="mt-1.5 text-[12px] text-accent">{t("slidesFull", { max: MAX_AD_SLIDES })}</p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{t("mediaHint", { max: MAX_AD_SLIDES })}</p>

          <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void upload("image", files, "slides");
              e.target.value = "";
            }} />
          <input ref={videoRef} type="file" accept="video/mp4" hidden multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void upload("video", files, "slides");
              e.target.value = "";
            }} />
          <input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && posterFor !== null) void upload("image", [f], { poster: posterFor });
              e.target.value = "";
            }} />
        </div>

        <div>
          <span className={label}>{t("fieldKind")}</span>
          <div className="flex flex-wrap gap-2">
            {AD_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set({ kind: k })}
                className={`h-11 rounded-[12px] border px-4 text-[13px] font-semibold ${
                  v.kind === k ? "border-accent bg-accent/12 text-foreground" : "border-hairline bg-card-alt text-muted"
                }`}
              >
                {t(`kind.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="ad-title">{t("fieldTitle")}</label>
          <input id="ad-title" className={field} value={v.title} onChange={(e) => set({ title: e.target.value })} />
        </div>

        <div>
          <label className={label} htmlFor="ad-body">{t("fieldBody")}</label>
          <textarea id="ad-body" className={`${field} min-h-[96px]`} maxLength={AD_BODY_MAX}
            value={v.body} onChange={(e) => set({ body: e.target.value })} />
          <p className="mt-1 text-[11px] text-muted">{t("noLinks")}</p>
        </div>

        <div className="grid min-w-0 gap-3 [&>div]:min-w-0">
          <div>
            <label className={label} htmlFor="ad-language">{t("fieldLanguage")}</label>
            <select id="ad-language" className={field} value={v.language} onChange={(e) => set({ language: e.target.value })}>
              {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted">{t("languageHint")}</p>
          </div>
        </div>

        {/* Голос материала: наша запись, своя запись или синтез браузера (слайс BZ). */}
        <AdVoiceField
          companyId={companyId}
          title={v.title}
          body={v.body ?? ""}
          language={v.language}
          audioUrl={v.audioUrl ?? ""}
          audioGenerated={Boolean(v.audioGenerated)}
          stale={
            Boolean(v.audioUrl) && Boolean(v.audioGenerated)
            && (v.audioTextHash ?? "") !== adTextHash(v.title, v.body ?? "")
          }
          onGenerated={({ url, voice, textHash }) =>
            set({ audioUrl: url, audioGenerated: true, audioVoice: voice, audioTextHash: textHash })
          }
          onUploaded={(url) => set({ audioUrl: url, audioGenerated: false, audioVoice: "", audioTextHash: "" })}
          onRemove={() => set({ audioUrl: "", audioGenerated: false, audioVoice: "", audioTextHash: "" })}
        />

        <div className="grid min-w-0 gap-3 [&>div]:min-w-0 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="ad-from">{t("fieldFrom")}</label>
            <input id="ad-from" type="date" className={field} value={v.startsAt ?? ""} onChange={(e) => set({ startsAt: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ad-to">{t("fieldTo")}</label>
            <input id="ad-to" type="date" className={field} value={v.endsAt ?? ""} onChange={(e) => set({ endsAt: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ad-event">{t("fieldEvent")}</label>
            <input id="ad-event" type="date" className={field} value={v.eventAt ?? ""} onChange={(e) => set({ eventAt: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="ad-event-end">{t("fieldEventEnd")}</label>
            <input id="ad-event-end" type="date" className={field} value={v.eventEndAt ?? ""}
              onChange={(e) => set({ eventEndAt: e.target.value })} />
            <p className="mt-1 text-[11px] text-muted">{t("eventEndHint")}</p>
          </div>
        </div>

        {/* Где это находится (слайс BZ): объект рекламы, а не точка приёма. */}
        <div ref={placeRef}>
        <AdPlaceField
          value={{
            placeName: v.placeName ?? "",
            placeAddress: v.placeAddress ?? "",
            placeLat: typeof v.placeLat === "number" ? v.placeLat : null,
            placeLon: typeof v.placeLon === "number" ? v.placeLon : null,
            placeAcceptedCoinIds: v.placeAcceptedCoinIds ?? [],
            placeAcceptedCardIds: v.placeAcceptedCardIds ?? [],
            placePaymentMethods: v.placePaymentMethods ?? [],
          }}
          onChange={(patch) => set(patch)}
          coins={coins}
          cards={cards}
          countryCode={countryCode}
          open={placeOpen}
          onOpenChange={setPlaceOpen}
        />
        </div>

        <div>
          <label className={label} htmlFor="ad-code">{t("fieldPromoCode")}</label>
          <input id="ad-code" className={field} value={v.promoCode ?? ""} onChange={(e) => set({ promoCode: e.target.value })} />
        </div>

        <div className="grid min-w-0 gap-3 [&>div]:min-w-0 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="ad-action">{t("fieldAction")}</label>
            <select id="ad-action" className={field} value={v.action} onChange={(e) => set({ action: e.target.value })}>
              {AD_ACTIONS.map((a) => <option key={a} value={a}>{t(`action.${a}`)}</option>)}
            </select>
          </div>
          {v.action === "PRODUCT" ? (
            <div>
              <label className={label} htmlFor="ad-product">{t("fieldProduct")}</label>
              <select id="ad-product" className={field} value={v.productId ?? ""} onChange={(e) => set({ productId: e.target.value })}>
                <option value="">—</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          ) : null}
          {v.action === "POINT" ? (
            <div className="sm:col-span-2">
              <span className={label}>{t("fieldPoint")}</span>
              {/* Две разные вещи, и обе законны: своя точка приёма и место самого
                  материала. Выбор — кнопками 48 px, а не строками списка: в
                  подчёркнутое слово пальцем не попасть (правило AN). */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-pressed={!v.pointId}
                  onClick={() => {
                    set({ pointId: "" });
                    setPlaceOpen(true);
                    requestAnimationFrame(() =>
                      placeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
                    );
                  }}
                  className={`flex min-h-[48px] flex-col justify-center rounded-[12px] border px-3 py-2 text-left ${
                    !v.pointId ? "border-accent bg-accent/12" : "border-hairline bg-card"
                  }`}
                >
                  <span className="text-[13px] font-semibold leading-tight">📍 {t("pointTargetPlace")}</span>
                  <span className="text-[11.5px] leading-tight text-muted">
                    {placeLine || t("pointTargetPlaceEmpty")}
                  </span>
                </button>
                {points.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={v.pointId === p.id}
                    onClick={() => set({ pointId: p.id })}
                    className={`flex min-h-[48px] items-center rounded-[12px] border px-3 py-2 text-left text-[13px] font-semibold ${
                      v.pointId === p.id ? "border-accent bg-accent/12" : "border-hairline bg-card"
                    }`}
                  >
                    🏬 {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {v.action === "WEBSITE" ? (
            <div>
              <label className={label} htmlFor="ad-url">{t("fieldUrl")}</label>
              <input id="ad-url" className={field} placeholder="https://" value={v.actionUrl ?? ""} onChange={(e) => set({ actionUrl: e.target.value })} />
            </div>
          ) : null}
        </div>

        {error ? (
          <p ref={errorRef} className="text-[13px] text-[#E55C5C]">{t(`errors.${error}`)}</p>
        ) : null}

        {/* Чего не хватает — словами и заранее. Кнопку не гасим: погасшая кнопка
            без объяснения уже была дефектом живого прогона BG. */}
        {missing.length > 0 ? (
          <p className="text-[12px] text-muted">{t("missingHint", { list: missing.join(", ") })}</p>
        ) : null}

        {/* Куда уйдёт правка — словами и заранее. Молчание тут создало бы
            впечатление, что изменение уже на витрине. */}
        {editMode === "proposal" ? (
          <p className="rounded-md border border-accent/40 bg-accent/10 p-2 text-[12px] text-accent">
            {t("proposalHint")}
          </p>
        ) : (
          <p className="text-[12px] text-muted">{t("draftHint")}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={submit} disabled={pending || uploading !== null}>
            {pending ? "…" : v.id ? (editMode === "proposal" ? t("saveForReview") : t("save")) : t("create")}
          </button>
          {v.id ? (
            <button type="button" className={button} onClick={() => { router.push("?"); router.refresh(); }}>
              {t("cancel")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
