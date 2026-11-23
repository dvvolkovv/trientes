"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createAd, updateAd } from "@/app/actions/company-ads";
import { AD_BODY_MAX, AD_KINDS, AD_ACTIONS, adTextHash, type AdInput } from "@/lib/ads/rules";
import { SUPPORTED_LOCALES } from "@/lib/locales";
import { AdPlaceField } from "@/components/ads/ad-place-field";
import { AdVoiceField } from "@/components/ads/ad-voice-field";
import type { PickerCoin } from "@/components/business/coin-picker";

export type AdFormValues = AdInput & { id?: string };

const EMPTY: AdFormValues = {
  kind: "PROMO", title: "", body: "", language: "en",
  mediaKind: "IMAGE", mediaUrl: "", posterUrl: "", audioUrl: "",
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
 */
export function AdForm({
  companyId,
  initial,
  points,
  products,
  defaultLanguage,
  coins,
  cards,
}: {
  companyId: string;
  initial?: AdFormValues | null;
  points: { id: string; label: string }[];
  products: { id: string; label: string }[];
  defaultLanguage: string;
  /** Монеты для места материала (BZ): тот же каталог, что в форме точки. */
  coins: PickerCoin[];
  cards: PickerCoin[];
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


  const set = (patch: Partial<AdFormValues>) => setV((prev) => ({ ...prev, ...patch }));

  const field = "w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm";
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";
  const label = "mb-1 block text-[11px] uppercase tracking-wider text-muted";

  const upload = async (slot: "image" | "video" | "audio", file: File, target: "media" | "poster" | "audio") => {
    setUploading(target);
    setError(null);
    try {
      const form = new FormData();
      form.set("companyId", companyId);
      form.set("slot", slot);
      form.set("file", file);
      const res = await fetch("/api/ads/media/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error ?? "upload_failed");
        return;
      }
      if (target === "media") set({ mediaUrl: data.url, mediaKind: slot === "video" ? "VIDEO" : "IMAGE" });
      else if (target === "poster") set({ posterUrl: data.url });
      else set({ audioUrl: data.url });
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
  if (!v.mediaUrl) missing.push(t("missing.media"));
  if (!v.title.trim()) missing.push(t("missing.title"));
  if (v.kind === "EVENT" && !(v.eventAt ?? "").trim()) missing.push(t("missing.event"));
  if (v.action === "PRODUCT" && !(v.productId ?? "").trim()) missing.push(t("missing.product"));
  if (v.action === "WEBSITE" && !(v.actionUrl ?? "").trim()) missing.push(t("missing.url"));
  if (v.action === "POINT" && !(v.pointId ?? "").trim() && !hasPlace) missing.push(t("missing.place"));

  return (
    <section className="mb-8 rounded-[18px] border border-hairline bg-card p-4">
      <h2 className="mb-3 text-[16px] font-semibold">{v.id ? t("editTitle") : t("newTitle")}</h2>

      <div className="space-y-3">
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

        {/* Кадр баннера. Он же единственное, что человек увидит свёрнутым. */}
        <div>
          <span className={label}>{t("fieldMedia")}</span>
          {v.mediaUrl ? (
            <div className="mb-2 overflow-hidden rounded-[14px] border border-hairline">
              {v.mediaKind === "VIDEO" ? (
                <video src={v.mediaUrl} poster={v.posterUrl ?? undefined} controls className="aspect-[16/10] w-full bg-black object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.mediaUrl} alt="" className="aspect-[16/10] w-full object-cover" />
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => imageRef.current?.click()} disabled={uploading !== null}>
              {uploading === "media" ? "…" : t("uploadImage")}
            </button>
            <button type="button" className={button} onClick={() => videoRef.current?.click()} disabled={uploading !== null}>
              {t("uploadVideo")}
            </button>
            {v.mediaKind === "VIDEO" ? (
              <button type="button" className={button} onClick={() => posterRef.current?.click()} disabled={uploading !== null}>
                {t("uploadPoster")}
              </button>
            ) : null}
          </div>
          <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("image", f, "media"); e.target.value = ""; }} />
          <input ref={videoRef} type="file" accept="video/mp4" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("video", f, "media"); e.target.value = ""; }} />
          <input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("image", f, "poster"); e.target.value = ""; }} />
          <p className="mt-1 text-[11px] text-muted">{t("mediaHint")}</p>
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

        <div className="grid gap-3">
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

        <div className="grid gap-3 sm:grid-cols-2">
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
          open={placeOpen}
          onOpenChange={setPlaceOpen}
        />
        </div>

        <div>
          <label className={label} htmlFor="ad-code">{t("fieldPromoCode")}</label>
          <input id="ad-code" className={field} value={v.promoCode ?? ""} onChange={(e) => set({ promoCode: e.target.value })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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

        <div className="flex gap-2">
          <button type="button" className={button} onClick={submit} disabled={pending || uploading !== null}>
            {pending ? "…" : v.id ? t("save") : t("create")}
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
