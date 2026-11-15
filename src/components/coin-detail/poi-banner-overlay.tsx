"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Poi } from "@/lib/crypto-map";
import { useTileGesture } from "@/components/coin-detail/poi-sheet-ui";
import { PoiPaneShowcase } from "@/components/coin-detail/poi-pane-showcase";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";

/**
 * Баннер заведения во весь экран. Плитка карточки показывает его кадрированным
 * по пропорции банковской карты, а здесь он виден целиком (`object-contain`):
 * обрезать то, ради чего человек и нажал, было бы странно.
 *
 * Под баннером — ручка, за которую он поднимается вверх, открывая внизу всё,
 * что с этим баннером можно сделать: рассказ заведения, связь и — у точки,
 * которую никто ещё не забрал себе, — кнопку «это моё предприятие». Содержимое
 * не переписано заново, а взято витриной карточки: два списка одних и тех же
 * утверждений разошлись бы при первой же правке.
 *
 * Живёт порталом в `document.body`, а не там, где написан: дорожка страниц
 * карточки сдвигается `transform`, а трансформированный предок делает
 * `position: fixed` отсчётом от себя — баннер «во весь экран» получался шириной
 * в три страницы и начинался под закладками.
 *
 * Закрывается четырьмя способами — крестиком, клавишей Escape, щелчком по
 * тёмному полю и жестом вниз по самому баннеру. Жест вниз по открытой нижней
 * части сначала опускает её, и только потом закрывает баннер: иначе один
 * смазанный жест вышвыривал бы человека из карточки.
 */
export function PoiBannerOverlay({
  src,
  poi,
  locale,
  onClose,
  t,
}: {
  src: string;
  poi: Poi;
  locale: string;
  onClose: () => void;
  t: StepTranslator;
}) {
  const [open, setOpen] = useState(false);
  // Жест по самому баннеру: вверх — поднять баннер и показать описание, вниз —
  // опустить его, а если показывать уже нечего, закрыть весь экран.
  const banner = useTileGesture({
    expanded: open,
    onChange: (next) => (next ? setOpen(true) : open ? setOpen(false) : onClose()),
  });
  // Жест по ручке меряется её собственной высотой, поэтому поднимается она
  // коротким движением, а не протяжкой в четверть экрана.
  const handle = useTileGesture({ expanded: open, onChange: setOpen });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Карточка под оверлеем слушает Escape тоже — закрываем только баннер.
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={poi.name}
      style={{ touchAction: "none" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex shrink-0 justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[20px] text-white/80 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div {...banner.handlers} className="min-h-0 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          data-testid="poi-banner-image"
        />
      </div>

      <div className="shrink-0 rounded-t-2xl border-t border-hairline bg-card text-foreground">
        <button
          type="button"
          aria-expanded={open}
          data-testid="poi-banner-handle"
          onClick={() => {
            // Протяжка заканчивается щелчком по той же ручке — её решение уже
            // принято жестом, второй раз переключать нельзя.
            if (handle.dragging()) return;
            setOpen(!open);
          }}
          {...handle.handlers}
          className="flex min-h-[44px] w-full flex-col items-center justify-center gap-1 px-4 py-2"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-hairline" />
          <span className="text-[12px] font-medium text-muted">
            {open ? t("bannerHideDetails") : t("bannerDetails")}
          </span>
        </button>
        {open && (
          <div
            className="max-h-[60vh] overflow-y-auto overscroll-contain"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <PoiPaneShowcase poi={poi} locale={locale} t={t} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
