"use client";

import { useEffect, useRef, useState } from "react";
import { type Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { useTranslations } from "next-intl";
import { addStaticMapAttribution, MAPLIBRE_ATTRIBUTION_OPTIONS } from "@/lib/maplibre-attribution";
import { tryCreateMap } from "@/lib/maplibre-map";
import { basemapStyle } from "@/lib/basemap";
import { CoinPicker, type PickerCoin } from "@/components/business/coin-picker";
import { PAYMENT_METHODS } from "@/lib/payment-methods";

/**
 * Место рекламного материала (слайс BZ): «где это находится».
 *
 * Объект рекламы — **не точка приёма**, и на общую карту он не попадает: карта
 * навигатора обещает «здесь принимают монеты», а офис, площадка события или дом в
 * продаже такого не обещают. Поэтому место живёт полями материала, а не строкой
 * `CompanyPoint`, и показывается только в самом материале.
 *
 * Булавка ставится нажатием по карте и двигается перетаскиванием; адрес можно просто
 * набрать — его ищет тот же геокодер, что в форме точки. Что здесь принимают —
 * свободное поле, как часы и вид заведения (BN): фильтром карты оно не служит.
 */
const PRAGUE: [number, number] = [14.4212535, 50.0874654];

export type AdPlaceValue = {
  placeName: string;
  placeAddress: string;
  placeLat: number | null;
  placeLon: number | null;
  placeAcceptedCoinIds: string[];
  placeAcceptedCardIds: string[];
  placePaymentMethods: string[];
};

export function AdPlaceField({
  value,
  onChange,
  coins,
  cards,
}: {
  value: AdPlaceValue;
  onChange: (patch: Partial<AdPlaceValue>) => void;
  coins: PickerCoin[];
  cards: PickerCoin[];
}) {
  const t = useTranslations("cabinetAds");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [open, setOpen] = useState(value.placeLat !== null && value.placeLon !== null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const field = "w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm";
  const label = "mb-1 block text-[11px] uppercase tracking-wider text-muted";
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";

  function placeMarker(map: MlMap, lng: number, lat: number) {
    if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
    else {
      const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
      mk.on("dragend", () => {
        const l = mk.getLngLat();
        onChangeRef.current({ placeLat: l.lat, placeLon: l.lng });
      });
      markerRef.current = mk;
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const map = tryCreateMap({
      container: containerRef.current,
      style: basemapStyle(),
      center: value.placeLon !== null && value.placeLat !== null ? [value.placeLon, value.placeLat] : PRAGUE,
      zoom: value.placeLat !== null ? 14 : 11,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    if (!map) {
      // Нет WebGL2 — карты нет, но место остаётся: адрес ищется словами, булавку
      // ставит геокодер (тот же запасной путь, что в форме точки).
      setMapUnavailable(true);
      return;
    }
    addStaticMapAttribution(map);
    mapRef.current = map;
    map.on("click", (e) => {
      onChangeRef.current({ placeLat: e.lngLat.lat, placeLon: e.lngLat.lng });
      placeMarker(map, e.lngLat.lng, e.lngLat.lat);
    });
    map.once("load", () => {
      if (value.placeLat !== null && value.placeLon !== null) placeMarker(map, value.placeLon, value.placeLat);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Карта создаётся один раз на раскрытие: пересоздавать её на каждое движение
    // булавки означало бы терять масштаб, выбранный человеком.
  }, [open]);

  async function findAddress() {
    const q = [value.placeName, value.placeAddress].filter(Boolean).join(", ").trim();
    if (!q) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const r = await fetch(`/api/crypto-map/geocode?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(8000),
      });
      const j = (await r.json()) as { results?: { lat: number; lon: number }[] };
      const top = j.results?.[0];
      if (top && Number.isFinite(top.lat) && Number.isFinite(top.lon)) {
        onChange({ placeLat: top.lat, placeLon: top.lon });
        const map = mapRef.current;
        if (map) placeMarker(map, top.lon, top.lat);
      } else {
        setSearchFailed(true);
      }
    } catch {
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }

  function clearPlace() {
    markerRef.current?.remove();
    markerRef.current = null;
    onChange({
      placeName: "", placeAddress: "", placeLat: null, placeLon: null,
      placeAcceptedCoinIds: [], placeAcceptedCardIds: [], placePaymentMethods: [],
    });
    setOpen(false);
  }

  if (!open) {
    return (
      <div>
        <span className={label}>{t("placeTitle")}</span>
        <button type="button" className={button} onClick={() => setOpen(true)}>
          📍 {t("placeAdd")}
        </button>
        <p className="mt-1 text-[11px] text-muted">{t("placeHint")}</p>
      </div>
    );
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="rounded-[14px] border border-hairline bg-card-alt/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className={`${label} mb-0`}>{t("placeTitle")}</span>
        <button type="button" className="text-[12px] text-muted underline" onClick={clearPlace}>
          {t("placeRemove")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ad-place-name">{t("placeName")}</label>
          <input id="ad-place-name" className={field} value={value.placeName}
            onChange={(e) => onChange({ placeName: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="ad-place-address">{t("placeAddress")}</label>
          <input id="ad-place-address" className={field} value={value.placeAddress}
            onChange={(e) => onChange({ placeAddress: e.target.value })} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={findAddress} disabled={searching}>
          {searching ? "…" : t("placeFind")}
        </button>
        {value.placeLat !== null && value.placeLon !== null ? (
          <span className="num text-[11.5px] text-muted">
            {value.placeLat.toFixed(5)}, {value.placeLon.toFixed(5)}
          </span>
        ) : (
          <span className="text-[11.5px] text-muted">{t("placeNoPin")}</span>
        )}
      </div>
      {searchFailed ? <p className="mt-1 text-[11.5px] text-muted">{t("placeNotFound")}</p> : null}

      {!mapUnavailable ? (
        <div ref={containerRef} className="mt-2 h-[260px] w-full overflow-hidden rounded-[14px] border border-hairline" />
      ) : null}
      <p className="mt-1 text-[11px] text-muted">{t("placeMapHint")}</p>

      <div className="mt-3">
        <span className={label}>{t("placeAccepts")}</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => {
            const on = value.placePaymentMethods.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange({ placePaymentMethods: toggle(value.placePaymentMethods, m.key) })}
                className={`h-11 rounded-[12px] border px-4 text-[13px] font-semibold ${
                  on ? "border-accent bg-accent/12 text-foreground" : "border-hairline bg-card text-muted"
                }`}
              >
                <span aria-hidden className="mr-1.5">{m.emoji}</span>
                {t(`payment.${m.key}`)}
              </button>
            );
          })}
        </div>
        <CoinPicker
          coins={[...cards, ...coins]}
          selected={[...value.placeAcceptedCardIds, ...value.placeAcceptedCoinIds]}
          onToggle={(id) => {
            const isCard = cards.some((c) => c.id === id);
            if (isCard) onChange({ placeAcceptedCardIds: toggle(value.placeAcceptedCardIds, id) });
            else onChange({ placeAcceptedCoinIds: toggle(value.placeAcceptedCoinIds, id) });
          }}
          searchLabel={t("placeCoinSearch")}
          emptyLabel={t("placeCoinEmpty")}
        />
      </div>
    </div>
  );
}
