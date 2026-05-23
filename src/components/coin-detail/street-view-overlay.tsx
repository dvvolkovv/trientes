"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { RankedShot } from "@/lib/streetview";

const SOURCE_LABEL: Record<string, { label: string; href: string }> = {
  mapillary: { label: "Mapillary", href: "https://www.mapillary.com" },
  panoramax: { label: "Panoramax", href: "https://panoramax.xyz" },
};

// Full-screen approach preview: a flythrough of street-level shots near the POI,
// played farthest→nearest so it feels like walking up to the place.
export function StreetViewOverlay({
  lat,
  lon,
  name,
  onClose,
}: {
  lat: number;
  lon: number;
  name: string;
  onClose: () => void;
}) {
  const t = useTranslations("cryptoMap");
  const [shots, setShots] = useState<RankedShot[] | null>(null); // null = loading
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crypto-map/streetview?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((res: { shots?: RankedShot[] }) => {
        if (cancelled) return;
        setShots([...(res.shots ?? [])].reverse()); // nearest-first → play far→near
        setIdx(0);
      })
      .catch(() => {
        if (!cancelled) setShots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  const count = shots?.length ?? 0;
  const step = useCallback(
    (d: number) => {
      setPlaying(false);
      setIdx((i) => (count ? (i + d + count) % count : 0));
    },
    [count],
  );

  // Autoplay the flythrough.
  useEffect(() => {
    if (!playing || count < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % count), 1500);
    return () => clearInterval(id);
  }, [playing, count]);

  // Keyboard: Esc closes, arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const cur = shots && count ? shots[idx] : null;
  const src = cur ? SOURCE_LABEL[cur.source] : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[860px] bg-card border border-hairline rounded-[18px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
          <div className="min-w-0">
            <div className="num text-[10px] uppercase tracking-[0.22em] text-muted">{t("streetviewTitle")}</div>
            <div className="font-semibold truncate">{name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-bg-tint transition-colors text-lg leading-none"
            aria-label={t("close")}
          >
            ✕
          </button>
        </div>

        {/* Stage */}
        <div className="relative bg-black aspect-[16/10] flex items-center justify-center">
          {shots === null && <div className="text-muted text-sm">{t("loading")}</div>}
          {shots !== null && count === 0 && (
            <div className="text-muted text-sm px-6 text-center">📷 {t("noStreetview")}</div>
          )}
          {cur && (
            <img
              key={cur.id}
              src={cur.thumb}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover animate-[cmap-fade_.3s_ease]"
            />
          )}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 text-white text-xl hover:bg-black/80 transition-colors"
                aria-label="←"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 text-white text-xl hover:bg-black/80 transition-colors"
                aria-label="→"
              >
                ›
              </button>
              {/* progress dots */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {shots!.map((s, i) => (
                  <span
                    key={s.id}
                    className="w-1.5 h-1.5 rounded-full transition-all"
                    style={{ background: i === idx ? "#F7931A" : "rgba(255,255,255,0.4)" }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {cur && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-muted flex-wrap">
            <div className="flex items-center gap-3">
              {count > 1 && (
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="px-3 py-1 rounded-md border border-hairline hover:text-foreground transition-colors"
                >
                  {playing ? "⏸" : "▶"}
                </button>
              )}
              <span className="num">
                {idx + 1} / {count}
              </span>
              <span className="num">≈ {Math.round(cur.distanceM)} м</span>
              {cur.capturedAt && <span>{new Date(cur.capturedAt).toLocaleDateString()}</span>}
            </div>
            {src && (
              <a href={src.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                © {src.label}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
