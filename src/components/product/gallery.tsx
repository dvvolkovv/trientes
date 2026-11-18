"use client";

import { useState } from "react";

export type GalleryPhoto = { url: string; label?: string };

/**
 * Фотографии и видео паспорта. Нажатие раскрывает снимок на весь экран — тот же приём,
 * что у плитки точки в навигаторе: на телефоне мелкая картинка товара бесполезна.
 */
export function ProductGallery({
  photos,
  videoUrl,
  name,
  closeLabel,
}: {
  photos: GalleryPhoto[];
  videoUrl: string | null;
  name: string;
  closeLabel: string;
}) {
  const [active, setActive] = useState(0);
  const [full, setFull] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  if (photos.length === 0 && !videoUrl) {
    return (
      <div className="aspect-[4/3] rounded-lg bg-hairline/30 flex items-center justify-center text-5xl opacity-40">
        📦
      </div>
    );
  }

  const current = photos[Math.min(active, Math.max(0, photos.length - 1))];

  return (
    <div>
      <div className="rounded-lg overflow-hidden bg-hairline/30 aspect-[4/3] flex items-center justify-center">
        {showVideo && videoUrl ? (
          // Своё видео, свой проигрыватель: чужой принёс бы в карточку магазина свою
          // рекламу и свои слежения.
          <video src={videoUrl} controls playsInline className="w-full h-full object-contain" />
        ) : current ? (
          <button type="button" onClick={() => setFull(true)} className="w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={current.label ?? name} className="w-full h-full object-cover" />
          </button>
        ) : videoUrl ? (
          <video src={videoUrl} controls playsInline className="w-full h-full object-contain" />
        ) : null}
      </div>

      {(photos.length > 1 || videoUrl) && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => {
                setShowVideo(false);
                setActive(i);
              }}
              className={`w-16 h-16 rounded-md overflow-hidden border ${
                !showVideo && i === active ? "border-accent" : "border-hairline"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          {videoUrl ? (
            <button
              type="button"
              onClick={() => setShowVideo(true)}
              className={`w-16 h-16 rounded-md border flex items-center justify-center text-xl ${
                showVideo ? "border-accent" : "border-hairline"
              }`}
              aria-label="video"
            >
              🎬
            </button>
          ) : null}
        </div>
      )}

      {full && current ? (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setFull(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.url} alt={current.label ?? name} className="max-w-full max-h-full object-contain" />
          <button
            type="button"
            className="absolute top-4 right-4 h-12 px-4 rounded-md bg-card text-sm"
            onClick={() => setFull(false)}
          >
            {closeLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
