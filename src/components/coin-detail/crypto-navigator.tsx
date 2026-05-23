"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, {
  Map as MlMap,
  GeolocateControl,
  NavigationControl,
  Marker,
  Popup,
  type StyleSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import type { Poi, PoiLayer, RouteResult } from "@/lib/crypto-map";

const MIN_ZOOM = 11; // below this the Overpass bbox would be too wide to query usefully
const PRAGUE: [number, number] = [14.4212535, 50.0874654]; // dense BTCMap coverage — a non-empty default

const LAYER_COLOR: Record<PoiLayer, string> = {
  merchant: "#30B658",
  atm: "#F7931A",
  financial: "#5B8DEF",
};

// Raster-only style (no glyphs needed — we draw circles + DOM popups). Dark base
// matches the Ledger palette; satellite + terrain are toggled on at runtime.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    dark: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap © CARTO",
      maxzoom: 20,
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
    },
    terrain: {
      type: "raster-dem",
      tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
    },
  },
  layers: [
    { id: "dark", type: "raster", source: "dark", layout: { visibility: "visible" } },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

type Base = "dark" | "satellite";

export default function CryptoNavigator({
  coinId,
  symbol,
  coinName,
}: {
  coinId: string;
  symbol: string;
  coinName: string;
}) {
  const t = useTranslations("cryptoMap");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const geolocateRef = useRef<GeolocateControl | null>(null);
  const originRef = useRef<[number, number] | null>(null);
  const originMarkerRef = useRef<Marker | null>(null);
  const destRef = useRef<{ lonlat: [number, number]; name: string } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [base, setBase] = useState<Base>("dark");
  const [is3D, setIs3D] = useState(false);
  const [visible, setVisible] = useState<Record<PoiLayer, boolean>>({
    merchant: true,
    atm: true,
    financial: true,
  });
  const [counts, setCounts] = useState<Record<PoiLayer, number>>({ merchant: 0, atm: 0, financial: 0 });
  const [tooFar, setTooFar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState<{ distance: number; duration: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // ---- POI loading for the current viewport ----
  const loadPois = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < MIN_ZOOM) {
      setTooFar(true);
      return;
    }
    setTooFar(false);
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",");
    setLoading(true);
    fetch(`/api/crypto-map/poi?bbox=${bbox}&coin=${encodeURIComponent(coinId)}&symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((res: { pois?: Poi[] }) => {
        const pois = res.pois ?? [];
        const src = map.getSource("pois") as GeoJSONSource | undefined;
        src?.setData({
          type: "FeatureCollection",
          features: pois.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: { ...p },
          })),
        });
        setCounts({
          merchant: pois.filter((p) => p.layer === "merchant").length,
          atm: pois.filter((p) => p.layer === "atm").length,
          financial: pois.filter((p) => p.layer === "financial").length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [coinId, symbol]);

  // ---- Routing ----
  const buildRoute = useCallback(() => {
    const map = mapRef.current;
    const origin = originRef.current;
    const dest = destRef.current;
    if (!map) return;
    if (!origin) {
      setStatus(t("noOrigin"));
      return;
    }
    if (!dest) {
      setStatus(t("pickDestination"));
      return;
    }
    setStatus(null);
    fetch(
      `/api/crypto-map/directions?from=${origin[0]},${origin[1]}&to=${dest.lonlat[0]},${dest.lonlat[1]}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((res: RouteResult) => {
        const src = map.getSource("route") as GeoJSONSource | undefined;
        src?.setData({ type: "Feature", geometry: res.geometry, properties: {} });
        setRoute({ distance: res.distance, duration: res.duration });
        const coords = res.geometry.coordinates;
        const bounds = coords.reduce(
          (bb, c) => bb.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
      })
      .catch(() => setStatus(t("noRoute")));
  }, [t]);

  const setDestination = useCallback(
    (lonlat: [number, number], name: string) => {
      destRef.current = { lonlat, name };
      if (originRef.current) buildRoute();
      else setStatus(t("noOrigin"));
    },
    [buildRoute, t],
  );

  // ---- Map setup (once) ----
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: PRAGUE,
      zoom: 13,
      pitch: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    const geo = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    });
    geolocateRef.current = geo;
    map.addControl(geo, "top-right");
    geo.on("geolocate", (e: GeolocationPosition) => {
      originRef.current = [e.coords.longitude, e.coords.latitude];
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      if (destRef.current) buildRoute();
    });

    map.on("load", () => {
      map.addSource("pois", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F7931A", "line-width": 5, "line-opacity": 0.85 },
      });

      (["financial", "atm", "merchant"] as PoiLayer[]).forEach((layer) => {
        map.addLayer({
          id: `poi-${layer}`,
          type: "circle",
          source: "pois",
          filter: ["==", ["get", "layer"], layer],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 8],
            "circle-color": LAYER_COLOR[layer],
            "circle-opacity": 0.9,
            // Coin-specific points get a bright white ring; the rest a subtle dark one.
            "circle-stroke-width": ["case", ["get", "coinSpecific"], 2.5, 1],
            "circle-stroke-color": ["case", ["get", "coinSpecific"], "#ffffff", "#161616"],
          },
        });

        map.on("mouseenter", `poi-${layer}`, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", `poi-${layer}`, () => (map.getCanvas().style.cursor = ""));
        map.on("click", `poi-${layer}`, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Poi;
          const lonlat = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          const el = document.createElement("div");
          el.className = "cmap-popup";
          el.innerHTML = `
            <div style="font-weight:600;margin-bottom:2px">${escapeHtml(p.name)}</div>
            <div style="color:#a09baa;font-size:12px;margin-bottom:4px">${escapeHtml(p.category)}${
              p.lightning ? " · ⚡ Lightning" : ""
            }</div>
            ${p.address ? `<div style="color:#a09baa;font-size:12px;margin-bottom:6px">${escapeHtml(p.address)}</div>` : ""}
            ${
              p.website
                ? `<a href="${escapeHtml(p.website)}" target="_blank" rel="noopener noreferrer nofollow" style="color:#5B8DEF;font-size:12px">${t(
                    "openSite",
                  )}</a><br/>`
                : ""
            }
          `;
          const btn = document.createElement("button");
          btn.textContent = t("routeHere");
          btn.style.cssText =
            "margin-top:6px;background:#F7931A;color:#0a0a0a;border:none;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer";
          btn.onclick = () => {
            setDestination(lonlat, p.name);
            popup.remove();
          };
          el.appendChild(btn);
          const popup = new Popup({ offset: 12, closeButton: true }).setLngLat(lonlat).setDOMContent(el).addTo(map);
        });
      });

      loadPois();
    });

    const onMoveEnd = () => {
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(loadPois, 500);
    };
    map.on("moveend", onMoveEnd);

    return () => {
      if (moveTimer.current) clearTimeout(moveTimer.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Control handlers ----
  function switchBase(next: Base) {
    const map = mapRef.current;
    if (!map) return;
    setBase(next);
    map.setLayoutProperty("dark", "visibility", next === "dark" ? "visible" : "none");
    map.setLayoutProperty("satellite", "visibility", next === "satellite" ? "visible" : "none");
  }

  function toggle3D() {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3D;
    setIs3D(next);
    if (next) {
      map.setTerrain({ source: "terrain", exaggeration: 1.3 });
      map.easeTo({ pitch: 60, duration: 800 });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      map.setTerrain(null);
    }
  }

  function toggleLayer(layer: PoiLayer) {
    const map = mapRef.current;
    if (!map) return;
    const next = !visible[layer];
    setVisible((v) => ({ ...v, [layer]: next }));
    map.setLayoutProperty(`poi-${layer}`, "visibility", next ? "visible" : "none");
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setStatus(null);
    fetch(`/api/crypto-map/geocode?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((res: { results?: { label: string; lat: number; lon: number }[] }) => {
        const top = res.results?.[0];
        const map = mapRef.current;
        if (!top || !map) {
          setStatus(t("notFound"));
          return;
        }
        const lonlat: [number, number] = [top.lon, top.lat];
        originRef.current = lonlat;
        originMarkerRef.current?.remove();
        originMarkerRef.current = new Marker({ color: "#F7931A" }).setLngLat(lonlat).addTo(map);
        map.flyTo({ center: lonlat, zoom: 14 });
        if (destRef.current) buildRoute();
      })
      .catch(() => setStatus(t("notFound")));
  }

  function clearRoute() {
    const map = mapRef.current;
    destRef.current = null;
    setRoute(null);
    setStatus(null);
    (map?.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  const btn = (active: boolean) =>
    "text-[12px] px-3 py-1.5 rounded-md font-medium transition-all " +
    (active ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground");

  return (
    <div className="bg-card border border-hairline rounded-[20px] p-4 md:p-6 space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => switchBase("dark")} className={btn(base === "dark")}>
            {t("streets")}
          </button>
          <button type="button" onClick={() => switchBase("satellite")} className={btn(base === "satellite")}>
            {t("satellite")}
          </button>
        </div>
        <button type="button" onClick={toggle3D} className={btn(is3D)}>
          {t("threeD")}
        </button>
        <button
          type="button"
          onClick={() => geolocateRef.current?.trigger()}
          className="text-[12px] px-3 py-1.5 rounded-md font-medium border border-hairline text-muted hover:text-foreground transition-all"
        >
          📍 {t("myLocation")}
        </button>
        <span className="num text-[11px] uppercase tracking-[0.18em] text-muted ml-auto">
          {symbol.toUpperCase()} · {coinName}
        </span>
      </div>

      {/* Address search */}
      <form onSubmit={submitSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="flex-1 bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px] placeholder:text-muted/60 focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="text-[12px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
        >
          {t("search")}
        </button>
      </form>

      {/* Map */}
      <div className="relative">
        <div ref={containerRef} className="w-full h-[420px] md:h-[520px] rounded-md overflow-hidden border border-hairline" />
        {tooFar && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-card/95 border border-hairline rounded-full px-4 py-1.5 text-[12px] text-muted pointer-events-none">
            {t("zoomIn")}
          </div>
        )}
        {loading && (
          <div className="absolute bottom-3 left-3 bg-card/95 border border-hairline rounded-full px-3 py-1 text-[11px] text-muted pointer-events-none">
            {t("loading")}
          </div>
        )}
      </div>

      {/* Legend + counts */}
      <div className="flex flex-wrap items-center gap-2">
        {(["merchant", "atm", "financial"] as PoiLayer[]).map((layer) => (
          <button
            key={layer}
            type="button"
            onClick={() => toggleLayer(layer)}
            className={
              "flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-md border transition-all " +
              (visible[layer] ? "border-hairline text-foreground" : "border-hairline text-muted/40")
            }
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLOR[layer] }} />
            {t(`layer_${layer}`)}
            <span className="num text-muted">{counts[layer]}</span>
          </button>
        ))}
        <span className="text-[11px] text-muted flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-white bg-transparent" />
          {t("coinHighlight", { symbol: symbol.toUpperCase() })}
        </span>
      </div>

      {/* Route summary */}
      {(route || status) && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] border-t border-hairline pt-3">
          {route && (
            <>
              <span className="text-muted">
                {t("distance")}: <span className="num text-foreground">{(route.distance / 1000).toFixed(1)} km</span>
              </span>
              <span className="text-muted">
                {t("duration")}: <span className="num text-foreground">{Math.round(route.duration / 60)} min</span>
              </span>
              <button type="button" onClick={clearRoute} className="text-muted hover:text-foreground underline">
                {t("clearRoute")}
              </button>
            </>
          )}
          {status && <span className="text-accent">{status}</span>}
        </div>
      )}

      <p className="text-[10px] text-muted/60 leading-relaxed">{t("dataNote")}</p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
