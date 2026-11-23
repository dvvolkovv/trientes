"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AD_VOICES, AD_VOICE_STYLES, AD_VOICE_DEFAULT, AD_VOICE_STYLE_DEFAULT } from "@/lib/ads/rules";

/**
 * Озвучка материала (слайс BZ). Решение владельца: голос должен быть живым, с
 * интонацией, и делаться прямо там, где собирается материал.
 *
 * Три пути и у каждого своё место:
 *   — наша запись: нажатие «озвучить», выбор голоса и манеры чтения;
 *   — своя запись продавца: загрузка файла, она сильнее нашей (правило BY);
 *   — ничего: текст прочитает браузер, если умеет.
 *
 * Молча переозвучивать при правке текста нельзя — это платный вызов наружу, то есть
 * чужие деньги. Молча оставлять расхождение тоже нельзя: рядом стоит честная строка
 * «запись сделана по прежнему тексту».
 */
export function AdVoiceField({
  companyId,
  title,
  body,
  language,
  audioUrl,
  audioGenerated,
  stale,
  onGenerated,
  onUploaded,
  onRemove,
}: {
  companyId: string;
  title: string;
  body: string;
  language: string;
  audioUrl: string;
  audioGenerated: boolean;
  stale: boolean;
  onGenerated: (v: { url: string; voice: string; textHash: string }) => void;
  onUploaded: (url: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("cabinetAds");
  const [voice, setVoice] = useState<string>(AD_VOICE_DEFAULT);
  const [style, setStyle] = useState<string>(AD_VOICE_STYLE_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const field = "w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm";
  const label = "mb-1 block text-[11px] uppercase tracking-wider text-muted";
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";

  async function generate() {
    if (!title.trim()) {
      setError("title_required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ads/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, title, body, voice, style, language }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; url?: string; voice?: string; textHash?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error ?? "voice_upstream");
        return;
      }
      onGenerated({ url: data.url, voice: data.voice ?? voice, textHash: data.textHash ?? "" });
    } catch {
      setError("voice_upstream");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("companyId", companyId);
      form.set("slot", "audio");
      form.set("file", file);
      const res = await fetch("/api/ads/media/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error ?? "upload_failed");
        return;
      }
      onUploaded(data.url);
    } catch {
      setError("upload_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-hairline bg-card-alt/40 p-3">
      <span className={label}>{t("fieldAudio")}</span>

      {audioUrl ? (
        <div className="mb-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={audioUrl} controls className="w-full" />
          <p className="mt-1 text-[11.5px] text-muted">
            {audioGenerated ? t("voiceOurs") : t("voiceYours")}
            {stale ? ` · ${t("voiceStale")}` : ""}
          </p>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ad-voice">{t("voiceVoice")}</label>
          <select id="ad-voice" className={field} value={voice} onChange={(e) => setVoice(e.target.value)}>
            {AD_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ad-voice-style">{t("voiceStyle")}</label>
          <select id="ad-voice-style" className={field} value={style} onChange={(e) => setStyle(e.target.value)}>
            {AD_VOICE_STYLES.map((s) => <option key={s} value={s}>{t(`voiceStyles.${s}`)}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={button} onClick={generate} disabled={busy}>
          {busy ? "…" : audioUrl && audioGenerated ? t("voiceRedo") : t("voiceMake")}
        </button>
        <button type="button" className={button} onClick={() => fileRef.current?.click()} disabled={busy}>
          {t("uploadAudio")}
        </button>
        {audioUrl ? (
          <button type="button" className="text-[12px] text-muted underline" onClick={onRemove}>
            {t("audioRemove")}
          </button>
        ) : null}
      </div>
      <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/x-m4a" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />

      {error ? <p className="mt-1 text-[12.5px] text-[#E55C5C]">{t(`errors.${error}`)}</p> : null}
      <p className="mt-1 text-[11px] text-muted">{t("voiceHint")}</p>
    </div>
  );
}
