"use client";

import { useEffect, useState } from "react";
import type { OgPreview, Poi, RouteMode, RouteStep, TransitLeg } from "@/lib/crypto-map";

/**
 * Общее у оболочки карточки точки и её страниц: размеры под палец, цвет слоя,
 * значок режима, тип маршрута и снимок места.
 *
 * Отдельный файл, а не экспорт из `poi-sheet.tsx`: оболочка импортирует
 * страницы, страницы — эти значения, и общий дом для них снимает круговой
 * импорт, который при правке разметки легко не заметить.
 */

export const LAYER_DOT: Record<string, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
  fintech: "#A855F7",
};

export const MODE_ICON: Record<RouteMode, string> = { walk: "🚶", car: "🚗", transit: "🚍" };

// Кнопка под палец: 44 px — минимум, по которому попадают не глядя.
export const TAP = "min-h-[44px] rounded-xl text-[13px] font-medium transition-all flex items-center gap-2 px-3";
export const PRIMARY = `${TAP} justify-center bg-accent text-accent-foreground hover:opacity-90 font-semibold`;
export const SECONDARY = `${TAP} justify-center border border-hairline text-foreground hover:border-accent`;
export const ROW_BTN = `${TAP} w-full border border-hairline text-foreground hover:border-accent bg-bg-tint/40`;
export const CHIP = "flex min-h-[40px] items-center gap-2 rounded-full border border-hairline px-3.5 text-[12px]";

/** Маршрут, который карточка показывает: сводка + геометрия для ведения. */
export type SheetRoute = {
  distance: number;
  duration: number;
  mode: RouteMode;
  transfers?: number;
  legs?: TransitLeg[];
  steps?: RouteStep[];
  coordinates: [number, number][];
};

/** Расстояние так, как его читают в сводке и в чипсе маршрута. */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export type PhotoState = { image: string | null; video: string | null; loading: boolean; onError: () => void };

/**
 * Снимок места: сначала картинка из OSM (если есть), затем — OpenGraph сайта
 * заведения. Битая картинка прячет слот целиком: сломанная иконка хуже пустоты.
 * Состояние не пересобирается под новую точку — навигатор монтирует карточку
 * заново на каждую точку (`key`), так что начальных значений достаточно.
 */
export function usePoiPhoto(poi: Poi, website: string | null): PhotoState {
  const [image, setImage] = useState<string | null>(poi.image);
  const [video, setVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!poi.image && !!website);

  useEffect(() => {
    if (!website) return;
    let cancelled = false;
    fetch(`/api/crypto-map/preview?url=${encodeURIComponent(website)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((res: { preview?: OgPreview }) => {
        if (cancelled) return;
        const og = res.preview ?? { title: null, image: null, video: null };
        if (og.image) setImage(og.image);
        setVideo(og.video ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [website]);

  return { image, video, loading, onError: () => setImage(null) };
}
