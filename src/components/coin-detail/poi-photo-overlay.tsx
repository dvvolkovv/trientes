"use client";

import { useEffect } from "react";
import { useTileGesture } from "@/components/coin-detail/poi-sheet-ui";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";

/**
 * Снимок места во весь экран. Плитка карточки показывает его кадрированным по
 * пропорции банковской карты, а здесь он виден целиком (`object-contain`):
 * обрезать то, ради чего человек и нажал, было бы странно.
 *
 * Закрывается тремя способами — крестиком, клавишей Escape и тем же жестом
 * вниз, которым сворачивается окно карты.
 */
export function PoiPhotoOverlay({
  src,
  onClose,
  t,
}: {
  src: string;
  onClose: () => void;
  t: StepTranslator;
}) {
  const gesture = useTileGesture({ expanded: true, onChange: (next) => !next && onClose() });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Карточка под оверлеем слушает Escape тоже — закрываем только снимок.
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      {...gesture}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[20px] text-white/80 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 object-contain pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      />
    </div>
  );
}
