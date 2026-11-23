"use client";

import { useEffect, useRef, useState } from "react";
import { type Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { addStaticMapAttribution, MAPLIBRE_ATTRIBUTION_OPTIONS } from "@/lib/maplibre-attribution";
import { tryCreateMap } from "@/lib/maplibre-map";
import { basemapStyle } from "@/lib/basemap";
import { buildLogoMarkerElement } from "@/lib/logo-marker";

/**
 * Место материала на карте (слайс BZ) — только показ, без выбора.
 *
 * Объект рекламы в фид карты не попадает (карта обещает «здесь принимают монеты»),
 * поэтому булавку рисуем сами: один маркер на той же подложке, что навигатор.
 *
 * Знак предприятия на булавке — просьба владельца 23 ноября: место без знака не
 * говорит, чьё оно. Знака нет — остаётся обычная оранжевая булавка.
 *
 * Нет WebGL2 — карты нет, и это не поломка страницы: адрес и кнопка «открыть на
 * карте» остаются (тот же запасной путь, что в форме точки).
 */
export function PlaceMap({
  lat,
  lon,
  label,
  logoUrl = null,
}: {
  lat: number;
  lon: number;
  label: string;
  logoUrl?: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const map = tryCreateMap({
      container: ref.current,
      style: basemapStyle(),
      center: [lon, lat],
      zoom: 15,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    if (!map) {
      setFailed(true);
      return;
    }
    addStaticMapAttribution(map);
    mapRef.current = map;
    if (logoUrl) {
      const { el, img } = buildLogoMarkerElement({ logoUrl, label, ringColor: "#FE5C04" });
      const mk = new Marker({ element: el, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
      // Битый знак булавку не отменяет: место остаётся отмеченным обычной.
      img?.addEventListener("error", () => {
        mk.remove();
        new Marker({ color: "#FE5C04" }).setLngLat([lon, lat]).addTo(map);
      });
    } else {
      new Marker({ color: "#FE5C04" }).setLngLat([lon, lat]).addTo(map);
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, logoUrl, label]);

  if (failed) return null;

  return (
    <div
      ref={ref}
      aria-label={label}
      className="aspect-[16/10] w-full overflow-hidden rounded-[18px] border border-hairline bg-bg-tint"
    />
  );
}
