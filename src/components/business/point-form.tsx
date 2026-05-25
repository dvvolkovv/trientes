"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import maplibregl, { Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCompanyPoint } from "@/app/actions/company";

const PRAGUE: [number, number] = [14.4212535, 50.0874654];
const TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE"] as const;

export function PointForm({ companyId, coins }: { companyId: string; coins: { id: string; symbol: string }[] }) {
  const t = useTranslations("business");
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Marker | null>(null);
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]>("SHOP");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { d: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OSM © CARTO" } }, layers: [{ id: "d", type: "raster", source: "d" }] },
      center: PRAGUE, zoom: 12,
    });
    const place = (lng: number, lat: number) => {
      setPos([lng, lat]);
      if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
      else {
        const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
        mk.on("dragend", () => { const l = mk.getLngLat(); setPos([l.lng, l.lat]); });
        markerRef.current = mk;
      }
    };
    map.on("click", (e) => place(e.lngLat.lng, e.lngLat.lat));
    return () => map.remove();
  }, []);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await submitCompanyPoint(companyId, {
        type, name, address, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null, acceptedCoinIds: accepted,
      });
      if (res.ok) { setMsg(t("pointSubmitted")); setName(""); setAddress(""); setAccepted([]); router.refresh(); }
      else setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
    });
  }

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
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("pointName")}
        className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("pointAddress")}
        className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]" />
      <p className="text-[12px] text-muted">{t("clickMapToPlace")}</p>
      <div ref={containerRef} className="w-full h-[320px] rounded-md overflow-hidden border border-hairline" />
      <div className="text-[12px] text-muted">{t("acceptedCoins")}:</div>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {coins.map((c) => {
          const on = accepted.includes(c.id);
          return (
            <button key={c.id} type="button"
              onClick={() => setAccepted((a) => on ? a.filter((x) => x !== c.id) : [...a, c.id])}
              className={`text-[11px] px-2 py-1 rounded-md border ${on ? "bg-accent/15 text-accent border-accent/40" : "border-hairline text-muted"}`}>
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
