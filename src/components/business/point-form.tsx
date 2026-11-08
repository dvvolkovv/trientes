"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Map as MlMap, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCompanyPoint, updateCompanyPoint } from "@/app/actions/company";
import { COUNTRIES, countryName } from "@/lib/countries";
import {
  addStaticMapAttribution,
  MAPLIBRE_ATTRIBUTION_OPTIONS,
} from "@/lib/maplibre-attribution";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const PRAGUE: [number, number] = [14.4212535, 50.0874654];
const TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE", "COMPANY", "ONLINE"] as const;
type PointType = (typeof TYPES)[number];

export type PointFormCoin = { id: string; symbol: string; logoUrl: string | null };
/** Одобренный собственный листинг — у него нет id CoinGecko, только CoinCard.id. */
export type PointFormCard = { id: string; symbol: string; name: string; logoUrl: string | null };

/** Существующая точка для правки. Та же форма, другой серверный вызов. */
export type PointFormInitial = {
  id: string;
  type: PointType;
  name: string;
  countryCode: string; city: string; street: string; houseNumber: string; postalCode: string;
  lat: number | null; lon: number | null;
  acceptedCoinIds: string[];
  acceptedCardIds: string[];
  photos: { url: string; label: string | null }[];
};

type Addr = { countryCode: string; city: string; street: string; houseNumber: string; postalCode: string };
const EMPTY_ADDR: Addr = { countryCode: "", city: "", street: "", houseNumber: "", postalCode: "" };

function addrToQuery(a: Addr): string {
  const line = [a.street, a.houseNumber].filter(Boolean).join(" ");
  const cityLine = [a.postalCode, a.city].filter(Boolean).join(" ");
  return [line, cityLine, countryName(a.countryCode)].filter(Boolean).join(", ");
}
function addrEqual(a: Addr, b: Addr): boolean {
  return a.countryCode === b.countryCode && a.city === b.city && a.street === b.street
    && a.houseNumber === b.houseNumber && a.postalCode === b.postalCode;
}
function addrFilledEnough(a: Addr): boolean {
  // Need at least country + (city OR postalCode) + street to be worth geocoding.
  return Boolean(a.countryCode && (a.city || a.postalCode) && a.street);
}

export function PointForm({
  companyId,
  companyStatus,
  coins,
  cards,
  initialCardIds = [],
  companyAddress,
  editing,
}: {
  companyId: string;
  companyStatus: "PENDING" | "APPROVED" | "REJECTED";
  coins: PointFormCoin[];
  cards: PointFormCard[];
  initialCardIds?: string[];
  companyAddress: Addr;
  editing?: PointFormInitial;
}) {
  const t = useTranslations("business");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const posRef = useRef<[number, number] | null>(
    editing?.lat != null && editing?.lon != null ? [editing.lon, editing.lat] : null,
  );
  const [pos, setPos] = useState<[number, number] | null>(posRef.current);
  const [type, setType] = useState<PointType>(editing?.type ?? "SHOP");
  const [name, setName] = useState(editing?.name ?? "");
  const [addr, setAddr] = useState<Addr>(
    editing
      ? {
          countryCode: editing.countryCode, city: editing.city, street: editing.street,
          houseNumber: editing.houseNumber, postalCode: editing.postalCode,
        }
      : EMPTY_ADDR,
  );
  const [useCompanyAddr, setUseCompanyAddr] = useState(false);
  const [accepted, setAccepted] = useState<string[]>(editing?.acceptedCoinIds ?? []);
  const [acceptedCards, setAcceptedCards] = useState<string[]>(
    editing ? editing.acceptedCardIds : initialCardIds,
  );
  const [photos, setPhotos] = useState<{ url: string; label: string | null }[]>(editing?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [pending, start] = useTransition();
  const router = useRouter();

  function updatePos(next: [number, number] | null) {
    posRef.current = next;
    setPos(next);
  }

  function placeMarker(lng: number, lat: number) {
    updatePos([lng, lat]);
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
    else {
      const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
      mk.on("dragend", () => { const l = mk.getLngLat(); updatePos([l.lng, l.lat]); });
      markerRef.current = mk;
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  }

  const mapVisible = type !== "ONLINE";
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MlMap({
      container: containerRef.current,
      // Same key-less dark base as the Crypto Navigator (CARTO now watermarks keyless tiles).
      style: "https://tiles.openfreemap.org/styles/dark",
      center: PRAGUE, zoom: 12,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    addStaticMapAttribution(map);
    mapRef.current = map;
    map.on("click", (e) => placeMarker(e.lngLat.lng, e.lngLat.lat));
    // Восстанавливаем актуальную позицию, включая изменения до ONLINE → SHOP.
    map.once("load", () => {
      const current = posRef.current;
      if (current) placeMarker(current[0], current[1]);
    });
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [mapVisible]);

  // When 'use company address' is toggled on, copy the company address in.
  function toggleUseCompanyAddr(on: boolean) {
    setUseCompanyAddr(on);
    if (on) setAddr({ ...companyAddress });
  }

  // Auto-geocode the structured address (debounced).
  const addrTouchedRef = useRef(!editing);
  useEffect(() => {
    // При открытии формы правки адрес уже заполнен — геокодер не должен
    // немедленно сдвинуть точку, которую владелец поставил руками.
    if (!addrTouchedRef.current) return;
    if (!addrFilledEnough(addr)) { setGeoStatus("idle"); return; }
    const q = addrToQuery(addr);
    if (!q) return;
    const ctrl = new AbortController();
    setGeoStatus("loading");
    const tm = setTimeout(async () => {
      try {
        const r = await fetch(`/api/crypto-map/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = (await r.json()) as { results?: { lon: number; lat: number }[] };
        const top = j.results?.[0];
        if (top && Number.isFinite(top.lat) && Number.isFinite(top.lon)) {
          placeMarker(top.lon, top.lat);
          setGeoStatus("ok");
        } else {
          setGeoStatus("fail");
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setGeoStatus("fail");
      }
    }, 600);
    return () => { ctrl.abort(); clearTimeout(tm); };
    // addrToQuery only depends on addr fields — re-run when any changes.
  }, [addr.countryCode, addr.city, addr.street, addr.houseNumber, addr.postalCode]);

  // If user edits address fields after toggling 'use company address', untick.
  function setAddrField<K extends keyof Addr>(k: K, v: string) {
    addrTouchedRef.current = true;
    const next = { ...addr, [k]: v };
    setAddr(next);
    if (useCompanyAddr && !addrEqual(next, companyAddress)) setUseCompanyAddr(false);
  }

  async function uploadPhoto(file: File) {
    if (photos.length >= 5) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("companyId", companyId);
      fd.append("file", file);
      const res = await fetch("/api/business/point/upload", { method: "POST", body: fd });
      const j = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (res.ok && j.url) {
        setPhotos((p) => [...p, { url: j.url!, label: null }]);
      } else {
        setMsg(t(`err.${j.error ?? "generic"}`) ?? t("err.generic"));
      }
    } catch {
      setMsg(t("err.generic"));
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setMsg(null);
    start(async () => {
      const payload = {
        type, name, ...addr, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null,
        acceptedCoinIds: accepted, acceptedCardIds: acceptedCards,
        photos,
      };
      if (editing) {
        const res = await updateCompanyPoint(editing.id, payload);
        if (res.ok) {
          setMsg(res.moderated ? t("pointBackToModeration") : t("pointSaved"));
          router.refresh();
        } else {
          setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
        }
        return;
      }
      const res = await submitCompanyPoint(companyId, {
        type, name, ...addr, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null,
        acceptedCoinIds: accepted, acceptedCardIds: acceptedCards,
        photos,
      });
      if (res.ok) {
        setMsg(t("pointSubmitted"));
        setName(""); setAddr(EMPTY_ADDR); setAccepted([]); setAcceptedCards([]);
        setUseCompanyAddr(false); setPhotos([]);
        if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
        updatePos(null);
        router.refresh();
      } else {
        setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
      }
    });
  }

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  const companyAddrAvailable = addrFilledEnough(companyAddress);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((tp) => (
          <button key={tp} type="button" onClick={() => setType(tp)}
            className={`text-[12px] px-3 py-1.5 rounded-md border ${type === tp ? "bg-foreground text-bg" : "border-hairline text-muted"}`}>
            {t(`type.${tp}`)}
          </button>
        ))}
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("pointName")} className={input} />

      {companyAddrAvailable && (
        <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer select-none">
          <input type="checkbox" checked={useCompanyAddr} onChange={(e) => toggleUseCompanyAddr(e.target.checked)} />
          {t("useCompanyAddress")}
        </label>
      )}

      <select className={input} value={addr.countryCode} onChange={(e) => setAddrField("countryCode", e.target.value)}>
        <option value="">{t("country")}</option>
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <input className={input} value={addr.city} onChange={(e) => setAddrField("city", e.target.value)} placeholder={t("city")} />
        <input className={input} value={addr.postalCode} onChange={(e) => setAddrField("postalCode", e.target.value)} placeholder={t("postalCode")} />
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <input className={input} value={addr.street} onChange={(e) => setAddrField("street", e.target.value)} placeholder={t("street")} />
        <input className={input} value={addr.houseNumber} onChange={(e) => setAddrField("houseNumber", e.target.value)} placeholder={t("houseNumber")} />
      </div>

      {type === "ONLINE" ? (
        <p className="text-[12px] text-muted">{t("onlineHint")}</p>
      ) : (
        <>
          <p className="text-[12px] text-muted">
            {geoStatus === "loading" && `↻ ${t("geocoding")}`}
            {geoStatus === "ok" && `● ${t("geocodingOk")}`}
            {geoStatus === "fail" && `⚠ ${t("geocodingFailed")}`}
            {geoStatus === "idle" && t("clickMapToPlace")}
          </p>
          <div ref={containerRef} className="w-full h-[320px] rounded-md overflow-hidden border border-hairline" />
        </>
      )}

      <div className="text-[12px] text-muted">{t("acceptedCoins")}:</div>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {coins.map((c) => {
          const on = accepted.includes(c.id);
          return (
            <button key={c.id} type="button"
              onClick={() => setAccepted((a) => on ? a.filter((x) => x !== c.id) : [...a, c.id])}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border ${on ? "bg-accent/15 text-accent border-accent/40" : "border-hairline text-muted"}`}>
              {c.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" width={14} height={14} className="rounded-full" />
              )}
              {c.symbol.toUpperCase()}
            </button>
          );
        })}
      </div>
      {cards.length > 0 && (
        <>
          <div className="text-[12px] text-muted">{t("ownListing")}:</div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {cards.map((c) => {
              const on = acceptedCards.includes(c.id);
              return (
                <button key={c.id} type="button" title={c.name}
                  onClick={() => setAcceptedCards((a) => on ? a.filter((x) => x !== c.id) : [...a, c.id])}
                  className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border ${on ? "bg-accent/15 text-accent border-accent/40" : "border-hairline text-muted"}`}>
                  {c.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" width={14} height={14} className="rounded-full" />
                  )}
                  {c.symbol.toUpperCase()}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="text-[12px] text-muted">{t("photos")} <span className="opacity-60">({photos.length}/5)</span></div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={p.url} className="relative w-16 h-16 rounded-md overflow-hidden border border-hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="w-full h-full object-cover" />
            <button type="button"
              onClick={() => setPhotos((arr) => arr.filter((_, idx) => idx !== i))}
              className="absolute top-0 right-0 bg-black/60 text-white text-[10px] w-4 h-4 leading-4 text-center">
              ×
            </button>
          </div>
        ))}
        {photos.length < 5 && (
          <label className="w-16 h-16 rounded-md border border-dashed border-hairline flex items-center justify-center text-[11px] text-muted cursor-pointer hover:bg-bg-tint">
            {uploading ? "↻" : "+ " + t("photo")}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ""; }}
              className="hidden" />
          </label>
        )}
      </div>

      {companyStatus !== "APPROVED" && (
        <p className="text-[12px] text-yellow-500 border border-yellow-500/30 bg-yellow-500/10 rounded-md px-3 py-2">
          {t("pointHiddenUntilCompanyApproved")}
        </p>
      )}

      <button type="button" disabled={pending || !name.trim() || (type !== "ONLINE" && !pos)} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {editing ? t("savePoint") : t("submitPoint")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
