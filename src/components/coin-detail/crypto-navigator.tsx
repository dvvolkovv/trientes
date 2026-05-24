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
import type { Poi, PoiLayer, RouteResult, RouteMode, TransitLeg, GeoResult, Social, OgPreview } from "@/lib/crypto-map";
import { StreetViewOverlay } from "@/components/coin-detail/street-view-overlay";
import { CURATED_POIS, type CuratedPoi } from "@/lib/curated-pois";
import { NavigationController, type NavigationCallbacks } from "./navigation-controller";
import { haversineMeters } from "@/lib/route-geometry";

// MapLibre flattens non-primitive feature properties to JSON strings, so `socials`
// rides through the GeoJSON source as a string and is parsed back when a popup opens.
type PoiProps = Omit<Poi, "socials"> & { socials: string };
type Translator = (key: string) => string;

const MIN_ZOOM = 11; // below this the Overpass bbox would be too wide to query usefully
const PRAGUE: [number, number] = [14.4212535, 50.0874654]; // dense BTCMap coverage — a non-empty default

const LAYER_COLOR: Record<PoiLayer, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
};

const MODE_ICON: Record<RouteMode, string> = { walk: "🚶", car: "🚗", transit: "🚍" };

// Emoji for a transit leg by MOTIS mode; vehicles fall back to a generic train.
const LEG_ICON: Record<string, string> = {
  WALK: "🚶",
  SUBWAY: "🚇",
  METRO: "🚇",
  RAIL: "🚆",
  REGIONAL_RAIL: "🚆",
  REGIONAL_FAST_RAIL: "🚆",
  LONG_DISTANCE: "🚆",
  HIGHSPEED_RAIL: "🚄",
  NIGHT_RAIL: "🚆",
  BUS: "🚌",
  COACH: "🚌",
  TRAM: "🚊",
  FERRY: "⛴️",
};

function legIcon(mode: string): string {
  return LEG_ICON[mode.toUpperCase()] ?? "🚆";
}

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
  const modeRef = useRef<RouteMode>("walk");
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
  const [mode, setMode] = useState<RouteMode>("walk");
  const [route, setRoute] = useState<{
    distance: number;
    duration: number;
    mode: RouteMode;
    transfers?: number;
    legs?: TransitLeg[];
    coordinates: [number, number][];
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [street, setStreet] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [navOffRoute, setNavOffRoute] = useState<number | null>(null);
  const [navRemaining, setNavRemaining] = useState<{ m: number; sec: number } | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const navControllerRef = useRef<NavigationController | null>(null);

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
            properties: { ...p, socials: JSON.stringify(p.socials) },
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
    const m = modeRef.current;
    setStatus(null);
    fetch(
      `/api/crypto-map/directions?from=${origin[0]},${origin[1]}&to=${dest.lonlat[0]},${dest.lonlat[1]}&mode=${m}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((res: RouteResult) => {
        const src = map.getSource("route") as GeoJSONSource | undefined;
        // Transit draws one feature per leg (walk connectors dashed, vehicles coloured);
        // walk/car is a single solid line.
        const features =
          res.mode === "transit" && res.legs?.length
            ? res.legs.map((lg) => ({
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: lg.coordinates },
                properties: { dashed: lg.dashed, color: lg.color },
              }))
            : [
                {
                  type: "Feature" as const,
                  geometry: res.geometry,
                  properties: { dashed: false, color: "#FE5C04" },
                },
              ];
        src?.setData({ type: "FeatureCollection", features });
        const coords = res.geometry.coordinates;
        setRoute({
          distance: res.distance,
          duration: res.duration,
          mode: res.mode,
          transfers: res.transfers,
          legs: res.legs,
          coordinates: coords,
        });
        if (navControllerRef.current) {
          navControllerRef.current.updateRoute(coords);
          setNavOffRoute(null);
        }
        if (coords.length && !navControllerRef.current) {
          const bounds = coords.reduce(
            (bb, c) => bb.extend(c as [number, number]),
            new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
        }
      })
      .catch(() => setStatus(modeRef.current === "transit" ? t("noTransit") : t("noRoute")));
  }, [t]);

  function switchMode(next: RouteMode) {
    modeRef.current = next;
    setMode(next);
    if (originRef.current && destRef.current) buildRoute();
  }

  const setDestination = useCallback(
    (lonlat: [number, number], name: string) => {
      destRef.current = { lonlat, name };
      if (originRef.current) buildRoute();
      else setStatus(t("noOrigin"));
    },
    [buildRoute, t],
  );

  // Resolve a pin to a street address (best-effort): show a placeholder, then upgrade.
  const reverseLabel = useCallback(
    (lonlat: [number, number]) => {
      setOriginLabel(t("posPin"));
      fetch(`/api/crypto-map/geocode?lat=${lonlat[1]}&lon=${lonlat[0]}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((res: { result?: GeoResult | null }) => {
          if (res.result?.label) setOriginLabel(res.result.label);
        })
        .catch(() => {});
    },
    [t],
  );

  // Single entry point for setting "my position": drops/moves a draggable orange
  // pin, labels it (reverse-geocoded when `reverse`), and rebuilds the route.
  const setOrigin = useCallback(
    (lonlat: [number, number], label: string | null, reverse: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      originRef.current = lonlat;
      if (originMarkerRef.current) {
        originMarkerRef.current.setLngLat(lonlat);
      } else {
        const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat(lonlat).addTo(map);
        mk.on("dragend", () => {
          const ll = mk.getLngLat();
          const next: [number, number] = [ll.lng, ll.lat];
          originRef.current = next;
          reverseLabel(next);
          if (destRef.current) buildRoute();
        });
        originMarkerRef.current = mk;
      }
      if (reverse) reverseLabel(lonlat);
      else setOriginLabel(label);
      if (destRef.current) buildRoute();
    },
    [buildRoute, reverseLabel],
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
      // GeolocateControl shows its own blue dot — drop the manual orange pin.
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      setOriginLabel(t("posGps"));
      if (destRef.current) buildRoute();
    });

    map.on("load", () => {
      map.addSource("pois", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "dashed"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#FE5C04"],
          "line-width": 5,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "route-walk",
        type: "line",
        source: "route",
        filter: ["==", ["get", "dashed"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#8a8f98",
          "line-width": 4,
          "line-opacity": 0.9,
          "line-dasharray": [1.5, 1.6],
        },
      });

      // Shared popup opener for OSM markers AND curated logo markers.
      const openPoiPopup = (lonlat: [number, number], p: PoiProps) => {
        const origin = originRef.current;
        const near = origin ? haversineMeters([origin[0], origin[1]], [lonlat[0], lonlat[1]]) <= 150 : false;
        const el = buildCard(p, t, near, modeRef.current === "walk");
        wirePhotoFallback(el);
        const popup = new Popup({ offset: 14, closeButton: true, maxWidth: "264px", className: "cmap-pop" })
          .setLngLat(lonlat)
          .setDOMContent(el)
          .addTo(map);
        el.querySelector<HTMLButtonElement>(".cmap-route")?.addEventListener("click", () => {
          setDestination(lonlat, p.name);
          popup.remove();
        });
        el.querySelector<HTMLButtonElement>(".cmap-street")?.addEventListener("click", () => {
          setStreet({ lat: lonlat[1], lon: lonlat[0], name: p.name });
          popup.remove();
        });
        el.querySelector<HTMLButtonElement>(".cmap-start")?.addEventListener("click", () => {
          setDestination(lonlat, p.name);
          popup.remove();
          setPendingStart(true);
        });
        hydratePhoto(el, p, t);
      };

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
          const p = f.properties as PoiProps;
          const lonlat = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          openPoiPopup(lonlat, p);
        });
      });

      // Click on empty map → drop/move the draggable "my position" pin.
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ["poi-merchant", "poi-atm", "poi-financial"],
        });
        if (hit.length) return; // a POI was clicked — its popup opener handles it
        setOrigin([e.lngLat.lng, e.lngLat.lat], null, true);
      });

      // Curated crypto-accepting businesses: always-on logo markers.
      CURATED_POIS.forEach((c) => {
        const elm = document.createElement("div");
        elm.className = "cmap-logo-marker";
        elm.title = c.name;
        elm.innerHTML = `<img src="${escapeHtml(c.logo)}" alt="${escapeHtml(c.name)}" loading="lazy"/>`;
        new Marker({ element: elm, anchor: "bottom" }).setLngLat([c.lon, c.lat]).addTo(map);
        elm.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openPoiPopup([c.lon, c.lat], curatedToProps(c));
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
      navControllerRef.current?.stop();
      navControllerRef.current = null;
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
      .then((res: { results?: GeoResult[] }) => {
        const top = res.results?.[0];
        const map = mapRef.current;
        if (!top || !map) {
          setStatus(t("notFound"));
          return;
        }
        const lonlat: [number, number] = [top.lon, top.lat];
        setOrigin(lonlat, top.label, false);
        map.flyTo({ center: lonlat, zoom: 14 });
      })
      .catch(() => setStatus(t("notFound")));
  }

  function clearOrigin() {
    const map = mapRef.current;
    originRef.current = null;
    setOriginLabel(null);
    originMarkerRef.current?.remove();
    originMarkerRef.current = null;
    // origin gone → the route is no longer valid; drop its geometry + summary.
    setRoute(null);
    setStatus(null);
    (map?.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [],
    });
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

  const stopNavigation = useCallback(() => {
    navControllerRef.current?.stop();
    navControllerRef.current = null;
    setNavActive(false);
    setNavOffRoute(null);
    setNavRemaining(null);
    setStatus(null);
    const map = mapRef.current;
    if (map) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, []);

  const startNavigation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !route || route.mode !== "walk") return;
    if (navControllerRef.current) return;

    setStatus(t("navStarting"));
    setNavError(null);

    const ctl = new NavigationController(route.coordinates);
    navControllerRef.current = ctl;

    const cb: NavigationCallbacks = {
      onPosition: (pos) => {
        const center: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const bearing =
          typeof pos.coords.heading === "number" &&
          typeof pos.coords.speed === "number" &&
          pos.coords.speed > 0.5
            ? pos.coords.heading
            : map.getBearing();
        map.easeTo({ center, bearing, pitch: 45, duration: 800 });
      },
      onProgress: (m, sec) => {
        setNavRemaining({ m, sec });
        setStatus(null);
      },
      onOffRoute: (dist) => {
        setNavOffRoute(dist);
      },
      onArrival: () => {
        setStatus(t("arrived"));
        window.setTimeout(() => stopNavigation(), 5000);
      },
      onError: (code) => {
        if (code === "permission_denied") setNavError(t("permissionDenied"));
        else setNavError(t("permissionDenied"));
        stopNavigation();
      },
    };

    setNavActive(true);
    map.easeTo({ zoom: 17, duration: 600 });
    await ctl.start(cb);
  }, [route, t, stopNavigation]);

  // Popup .cmap-start click sets pendingStart; once route settles for walk mode, fire navigation.
  useEffect(() => {
    if (pendingStart && route && route.mode === "walk") {
      setPendingStart(false);
      void startNavigation();
    }
  }, [pendingStart, route, startNavigation]);

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
        <span className="num text-[11px] uppercase tracking-[0.18em] text-muted ml-auto">
          {symbol.toUpperCase()} · {coinName}
        </span>
      </div>

      {/* My position */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("myPosition")}</span>
          {originLabel && (
            <span className="flex items-center gap-1.5 text-[12px] text-foreground bg-bg-tint border border-hairline rounded-full pl-2.5 pr-1.5 py-0.5 max-w-full">
              <span className="truncate max-w-[240px]">{originLabel}</span>
              <button
                type="button"
                onClick={clearOrigin}
                title={t("clearOrigin")}
                aria-label={t("clearOrigin")}
                className="text-muted hover:text-foreground leading-none"
              >
                ✕
              </button>
            </span>
          )}
        </div>
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => geolocateRef.current?.trigger()}
            className="text-[12px] px-3 py-2 rounded-md font-medium border border-hairline text-muted hover:text-foreground transition-all whitespace-nowrap"
          >
            📍 {t("posAuto")}
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="flex-1 min-w-[140px] bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px] placeholder:text-muted/60 focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="text-[12px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
          >
            {t("search")}
          </button>
        </form>
        <p className="text-[11px] text-muted/70">{t("clickToDrop")}</p>
      </div>

      {/* Travel mode */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted mr-1">{t("travelMode")}</span>
        {(["walk", "car", "transit"] as RouteMode[]).map((m) => (
          <button key={m} type="button" onClick={() => switchMode(m)} className={btn(mode === m)}>
            {MODE_ICON[m]} {t(`mode_${m}`)}
          </button>
        ))}
      </div>

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
      {(route || status || navError) && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] border-t border-hairline pt-3">
          {route && (
            <>
              {!navActive && (
                <span className="text-muted">
                  {t("duration")}: <span className="num text-foreground">{Math.round(route.duration / 60)} min</span>
                </span>
              )}
              {navActive && navRemaining && (
                <span className="text-muted">
                  {t("remaining")}:{" "}
                  <span className="num text-foreground">
                    {(navRemaining.m / 1000).toFixed(navRemaining.m < 1000 ? 2 : 1)} km
                  </span>
                  {" · "}
                  <span className="num text-foreground">
                    {t("etaMin", { min: Math.max(1, Math.round(navRemaining.sec / 60)) })}
                  </span>
                </span>
              )}
              {route.mode === "transit" ? (
                <>
                  <span className="text-muted">
                    {route.transfers ? t("transfers", { count: route.transfers }) : t("transitDirect")}
                  </span>
                  {route.legs && route.legs.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {route.legs.map((lg, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          {i > 0 && <span className="text-muted/50">›</span>}
                          <span style={{ color: lg.dashed ? undefined : lg.color }}>
                            {legIcon(lg.mode)}
                            {lg.line ? ` ${lg.line}` : ""}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted">
                  {t("distance")}: <span className="num text-foreground">{(route.distance / 1000).toFixed(1)} km</span>
                </span>
              )}
              {route.mode === "walk" && !navActive && (
                <button
                  type="button"
                  onClick={startNavigation}
                  className="text-accent hover:opacity-80 font-medium"
                  aria-label={t("start")}
                >
                  ▶ {t("start")}
                </button>
              )}
              {navActive && (
                <>
                  <button
                    type="button"
                    onClick={stopNavigation}
                    className="text-down hover:opacity-80 font-medium"
                    aria-label={t("stop")}
                  >
                    ■ {t("stop")}
                  </button>
                  {navOffRoute !== null && navOffRoute > 30 && (
                    <button
                      type="button"
                      onClick={() => buildRoute()}
                      className="text-accent hover:opacity-80 font-medium"
                      aria-label={t("recompute")}
                    >
                      ↻ {t("recompute")}
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={clearRoute} className="text-muted hover:text-foreground underline">
                {t("clearRoute")}
              </button>
            </>
          )}
          {status && <span className="text-accent">{status}</span>}
          {navError && <span className="text-down">{navError}</span>}
        </div>
      )}

      <p className="text-[10px] text-muted/60 leading-relaxed">{t("dataNote")}</p>

      {street && (
        <StreetViewOverlay lat={street.lat} lon={street.lon} name={street.name} onClose={() => setStreet(null)} />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Mirror of lib `safeHttpUrl`. Can't import it: crypto-map.ts pulls in node:dns,
// so this client bundle only takes its types. Keep the two in sync.
function safeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

// Collapse the photo slot if its image fails to load (404, hotlink block, or an
// http image blocked as mixed content on the https page) instead of showing a broken icon.
function wirePhotoFallback(el: HTMLElement): void {
  el.querySelectorAll<HTMLImageElement>(".cmap-photo img").forEach((img) => {
    img.onerror = () => img.closest(".cmap-photo")?.remove();
  });
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  vk: "VK",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
};

function parseSocialProps(raw: unknown): Social[] {
  if (Array.isArray(raw)) return raw as Social[];
  if (typeof raw === "string" && raw) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as Social[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function infoRow(icon: string, inner: string): string {
  return `<div class="cmap-row"><span class="i">${icon}</span><span>${inner}</span></div>`;
}

// Build the dark Ledger detail card. Photo slot leads (skeleton until the OG preview
// resolves, or an OSM image straight away); empty fields are omitted.
function buildCard(p: PoiProps, t: Translator, near: boolean, showStart: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cmap-popup";

  const website = safeWebsite(p.website);
  const hasPhoto = !!p.image || !!website;
  const photoHtml = hasPhoto
    ? `<div class="cmap-photo">${
        p.image
          ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`
          : `<div class="cmap-skel"></div>`
      }</div>`
    : "";

  const rows: string[] = [];
  if (p.openingHours) rows.push(infoRow("🕒", escapeHtml(p.openingHours)));
  if (p.address) rows.push(infoRow("📍", escapeHtml(p.address)));
  if (p.phone) rows.push(infoRow("📞", `<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>`));
  if (p.email) rows.push(infoRow("✉️", `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>`));

  const socials = parseSocialProps(p.socials);
  const socialHtml = socials.length
    ? `<div class="cmap-socials">${socials
        .map(
          (s) =>
            `<a class="cmap-chip" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(
              SOCIAL_LABELS[s.network] ?? s.network,
            )}</a>`,
        )
        .join("")}</div>`
    : "";

  el.innerHTML = `
    ${photoHtml}
    <div class="cmap-body">
      <div class="cmap-title">${escapeHtml(p.name)}</div>
      <div class="cmap-sub">${escapeHtml(p.category)}${p.lightning ? " · ⚡ Lightning" : ""}</div>
      ${rows.join("")}
      ${socialHtml}
      ${
        website
          ? `<a class="cmap-site" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(
              t("openSite"),
            )} ↗</a>`
          : ""
      }
      <button type="button" class="cmap-route">${escapeHtml(t("routeHere"))}</button>
      <button type="button" class="cmap-street${near ? " is-near" : ""}">👁 ${escapeHtml(t("streetview"))}${
        near ? `<span class="cmap-near">${escapeHtml(t("streetviewNear"))}</span>` : ""
      }</button>
      ${showStart ? `<button type="button" class="cmap-start">▶ ${escapeHtml(t("start"))}</button>` : ""}
    </div>`;
  return el;
}


// Adapt a curated entry into the same flattened shape an OSM popup expects, so it
// reuses buildCard (logo doubles as the card photo; always coin-highlighted).
function curatedToProps(c: CuratedPoi): PoiProps {
  return {
    id: c.id,
    lat: c.lat,
    lon: c.lon,
    name: c.name,
    layer: "merchant",
    category: c.category,
    address: c.address,
    lightning: c.lightning,
    coinSpecific: true,
    website: c.website,
    openingHours: null,
    phone: c.phone,
    email: c.email,
    socials: JSON.stringify(c.socials),
    image: c.logo,
  };
}

// Lazily upgrade the photo slot with the place's own OpenGraph splash. Guards against
// the popup being closed mid-flight; prefers the source image, falls back to OSM's.
function hydratePhoto(el: HTMLElement, p: PoiProps, t: Translator): void {
  const website = safeWebsite(p.website);
  if (!website) return; // OSM image (if any) is already shown; nothing to fetch
  const photo = el.querySelector<HTMLElement>(".cmap-photo");
  fetch(`/api/crypto-map/preview?url=${encodeURIComponent(website)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
    .then((res: { preview?: OgPreview }) => {
      if (!el.isConnected || !photo) return;
      const og = res.preview ?? { title: null, image: null, video: null };
      if (og.image) {
        photo.innerHTML = `<img src="${escapeHtml(og.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`;
        wirePhotoFallback(el);
      } else if (!p.image) {
        photo.remove();
        return;
      }
      if (og.video && photo.isConnected) {
        const a = document.createElement("a");
        a.className = "cmap-video";
        a.href = website;
        a.target = "_blank";
        a.rel = "noopener noreferrer nofollow";
        a.textContent = `▶ ${t("watchVideo")}`;
        photo.appendChild(a);
      }
    })
    .catch(() => {
      if (el.isConnected && !p.image) photo?.remove();
    });
}
