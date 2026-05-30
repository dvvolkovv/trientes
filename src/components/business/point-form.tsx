"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import maplibregl, { Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCompanyPoint } from "@/app/actions/company";
import { COUNTRIES, countryName } from "@/lib/countries";

const PRAGUE: [number, number] = [14.4212535, 50.0874654];
const TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE", "COMPANY"] as const;
type PointType = (typeof TYPES)[number];

export type PointFormCoin = { id: string; symbol: string; logoUrl: string | null };

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
  coins,
  companyAddress,
}: {
  companyId: string;
  coins: PointFormCoin[];
  companyAddress: Addr;
}) {
  const t = useTranslations("business");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [type, setType] = useState<PointType>("SHOP");
  const [name, setName] = useState("");
  const [addr, setAddr] = useState<Addr>(EMPTY_ADDR);
  const [useCompanyAddr, setUseCompanyAddr] = useState(false);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [pending, start] = useTransition();
  const router = useRouter();

  function placeMarker(lng: number, lat: number) {
    setPos([lng, lat]);
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
    else {
      const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
      mk.on("dragend", () => { const l = mk.getLngLat(); setPos([l.lng, l.lat]); });
      markerRef.current = mk;
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { d: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OSM © CARTO" } }, layers: [{ id: "d", type: "raster", source: "d" }] },
      center: PRAGUE, zoom: 12,
    });
    mapRef.current = map;
    map.on("click", (e) => placeMarker(e.lngLat.lng, e.lngLat.lat));
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  // When 'use company address' is toggled on, copy the company address in.
  function toggleUseCompanyAddr(on: boolean) {
    setUseCompanyAddr(on);
    if (on) setAddr({ ...companyAddress });
  }

  // Auto-geocode the structured address (debounced).
  useEffect(() => {
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
    const next = { ...addr, [k]: v };
    setAddr(next);
    if (useCompanyAddr && !addrEqual(next, companyAddress)) setUseCompanyAddr(false);
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await submitCompanyPoint(companyId, {
        type, name, ...addr, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null, acceptedCoinIds: accepted,
      });
      if (res.ok) {
        setMsg(t("pointSubmitted"));
        setName(""); setAddr(EMPTY_ADDR); setAccepted([]); setUseCompanyAddr(false);
        if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
        setPos(null);
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

      <p className="text-[12px] text-muted">
        {geoStatus === "loading" && `↻ ${t("geocoding")}`}
        {geoStatus === "ok" && `● ${t("geocodingOk")}`}
        {geoStatus === "fail" && `⚠ ${t("geocodingFailed")}`}
        {geoStatus === "idle" && t("clickMapToPlace")}
      </p>
      <div ref={containerRef} className="w-full h-[320px] rounded-md overflow-hidden border border-hairline" />

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
      <button type="button" disabled={pending || !pos || !name.trim()} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {t("submitPoint")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
