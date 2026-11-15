"use client";

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import {
  type Map as MlMap,
  LngLatBounds,
  GeolocateControl,
  NavigationControl,
  Marker,
  type SourceSpecification,
  type GeoJSONSource,
  type GeolocatePositionEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { useLocale, useTranslations } from "next-intl";
import type { Poi, PoiLayer, RouteResult, RouteMode, GeoResult, Social } from "@/lib/crypto-map";
import { activeStep, announcementBand, cumulativeEnds } from "@/lib/route-steps";
import {
  ManeuverBanner,
  maneuverText,
  spokenDistance,
} from "@/components/coin-detail/route-steps-panel";
import { StreetViewOverlay } from "@/components/coin-detail/street-view-overlay";
import { MODE_ICON, PoiSheet, type SheetRoute } from "@/components/coin-detail/poi-sheet";
import { CURATED_POIS, type CuratedPoi } from "@/lib/curated-pois";
import { NavigationController, type NavigationCallbacks } from "./navigation-controller";
import { haversineMeters } from "@/lib/route-geometry";
import { AvailableFintechPanel } from "@/components/fintech/available-fintech-panel";
import {
  addStaticMapAttribution,
  MAPLIBRE_ATTRIBUTION_OPTIONS,
} from "@/lib/maplibre-attribution";
import { tryCreateMap } from "@/lib/maplibre-map";
import { basemapStyle } from "@/lib/basemap";


// MapLibre flattens non-primitive feature properties to JSON strings, so `socials`
// rides through the GeoJSON source as a string and is parsed back when a popup opens.
type PoiProps = Omit<Poi, "socials"> & { socials: string };
type FilterSpecification = NonNullable<Parameters<MlMap["setFilter"]>[1]>;

const MIN_ZOOM = 11; // below this the bbox is too wide to return a useful number of points
const PRAGUE: [number, number] = [14.4212535, 50.0874654]; // dense BTCMap coverage — a non-empty default

const POI_LAYERS = ["merchant", "atm", "financial", "fintech"] as const satisfies readonly PoiLayer[];

const LAYER_COLOR: Record<PoiLayer, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
  fintech: "#A855F7",
};

const VOICE_KEY = "cmap:voice";

// Speech synthesis exists only in the browser, so the server snapshot is false
// and the voice control appears after hydration instead of mismatching it.
const subscribeNever = () => () => {};
const hasSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

// Телефон или нет решает медиазапрос браузера, а не высота окна карты: от
// этого зависит, разворачивается ли ведение на весь экран устройства.
const PHONE_QUERY = "(max-width: 767px)";
const subscribePhone = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const isPhoneNow = () => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

function readVoicePreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true; // storage blocked (private mode) — voice stays on
  }
}

// The base map itself lives in src/lib/basemap.ts (openstreetmap.org raster,
// with a one-line rollback to a vector base). Satellite + terrain are grafted
// onto whichever style it returns, on load and toggled at runtime.
const SATELLITE_SOURCE: SourceSpecification = {
  type: "raster",
  tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
  tileSize: 256,
  attribution: "© Esri, Maxar, Earthstar Geographics",
  maxzoom: 19,
};

const TERRAIN_SOURCE: SourceSpecification = {
  type: "raster-dem",
  tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
};

type Base = "map" | "satellite";

function applyCoinOnlyFilter(map: MlMap, coinOnly: boolean) {
  POI_LAYERS.forEach((layer) => {
    const base: FilterSpecification = ["==", ["get", "layer"], layer];
    const filter: FilterSpecification = coinOnly
      ? (["all", base, ["==", ["get", "coinSpecific"], true]] as FilterSpecification)
      : base;
    map.setFilter(`poi-${layer}`, filter);
  });
}

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
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mapReadyRef = useRef(false);
  const geolocateRef = useRef<GeolocateControl | null>(null);
  const originRef = useRef<[number, number] | null>(null);
  const originMarkerRef = useRef<Marker | null>(null);
  const destRef = useRef<{ lonlat: [number, number]; name: string } | null>(null);
  const modeRef = useRef<RouteMode>("walk");
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poiAbortRef = useRef<AbortController | null>(null);
  const poiSequenceRef = useRef(0);
  const routeAbortRef = useRef<AbortController | null>(null);
  const routeSequenceRef = useRef(0);
  const coinOnlyRef = useRef(false);
  const destKeyRef = useRef<string | null>(null);
  const routeCoordsRef = useRef<[number, number][]>([]);

  const [base, setBase] = useState<Base>("map");
  const baseRef = useRef<Base>("map");
  const [is3D, setIs3D] = useState(false);
  const is3DRef = useRef(false);
  const [visible, setVisible] = useState<Record<PoiLayer, boolean>>({
    merchant: true,
    atm: true,
    financial: true,
    fintech: true,
  });
  const visibleRef = useRef<Record<PoiLayer, boolean>>({
    merchant: true,
    atm: true,
    financial: true,
    fintech: true,
  });
  const [counts, setCounts] = useState<Record<PoiLayer, number>>({ merchant: 0, atm: 0, financial: 0, fintech: 0 });
  const [coinOnly, setCoinOnly] = useState(false);
  const [tooFar, setTooFar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RouteMode>("walk");
  const [route, setRoute] = useState<SheetRoute | null>(null);
  // К какой точке построен маршрут. Карточка другой точки не должна показывать
  // чужую сводку как свою, поэтому сверяется ключ, а не наличие маршрута.
  const [destKey, setDestKey] = useState<string | null>(null);
  const [routePoi, setRoutePoi] = useState<Poi | null>(null);
  // Своё положение держится и в ref (для замыканий карты), и в состоянии: от
  // него зависит, что показывает карточка точки.
  const [origin, setOriginState] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [street, setStreet] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [navOffRoute, setNavOffRoute] = useState<number | null>(null);
  const [navRemaining, setNavRemaining] = useState<{ m: number; sec: number } | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const [navStep, setNavStep] = useState<{ index: number; distanceToManeuver: number } | null>(null);
  const [voiceOn, setVoiceOn] = useState(readVoicePreference);
  const voiceOnRef = useRef(voiceOn);
  // Which announcement bands have already been spoken for the step being travelled.
  const spokenRef = useRef<{ index: number; bands: Set<string> }>({ index: -1, bands: new Set() });
  const navControllerRef = useRef<NavigationController | null>(null);
  // Tracked map center for the AvailableFintechPanel — debounced inside the panel.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  // No WebGL2 (or MapLibre failed to start): show a notice instead of the map.
  // mapRef then stays null, so every map handler below is a no-op.
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const cancelRouteRequest = useCallback(() => {
    routeSequenceRef.current += 1;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
  }, []);

  function applyDesiredMapState(map: MlMap) {
    map.setLayoutProperty("satellite", "visibility", baseRef.current === "satellite" ? "visible" : "none");
    POI_LAYERS.forEach((layer) => {
      map.setLayoutProperty(`poi-${layer}`, "visibility", visibleRef.current[layer] ? "visible" : "none");
    });
    applyCoinOnlyFilter(map, coinOnlyRef.current);
    if (is3DRef.current) {
      map.setTerrain({ source: "terrain", exaggeration: 1.3 });
      map.easeTo({ pitch: 60, duration: 800 });
    }
  }

  // ---- POI loading for the current viewport ----
  const loadPois = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const request = ++poiSequenceRef.current;
    poiAbortRef.current?.abort();
    poiAbortRef.current = null;
    if (map.getZoom() < MIN_ZOOM) {
      setTooFar(true);
      setLoading(false);
      return;
    }
    setTooFar(false);
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",");
    const controller = new AbortController();
    poiAbortRef.current = controller;
    setLoading(true);
    fetch(`/api/crypto-map/poi?bbox=${bbox}&coin=${encodeURIComponent(coinId)}&symbol=${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((res: { pois?: Poi[] }) => {
        if (request !== poiSequenceRef.current || mapRef.current !== map) return;
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
          fintech: pois.filter((p) => p.layer === "fintech").length,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (request !== poiSequenceRef.current) return;
        poiAbortRef.current = null;
        setLoading(false);
      });
  }, [coinId, symbol]);

  // Маршрут вписывается в ту часть карты, которую видно: на телефоне нижнюю
  // половину занимает пристыкованная карточка, и без этого линия уезжает под
  // неё. Высота берётся у самой карточки, а не угадывается числом.
  function fitRoute() {
    const map = mapRef.current;
    const coords = routeCoordsRef.current;
    if (!map || coords.length === 0 || navControllerRef.current) return;
    const sheet = document.querySelector('[role="dialog"]');
    const sheetRect = isPhoneNow() && sheet ? sheet.getBoundingClientRect() : null;
    const bottom = sheetRect
      ? Math.min(Math.round(sheetRect.height) + 20, Math.round(window.innerHeight * 0.7))
      : 60;
    const bounds = coords.reduce(
      (bb, c) => bb.extend(c),
      new LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, {
      padding: { top: 70, left: 24, right: 24, bottom },
      maxZoom: 16,
    });
  }

  // ---- Routing ----
  const buildRoute = useCallback(() => {
    const map = mapRef.current;
    const origin = originRef.current;
    const dest = destRef.current;
    if (!map) return;
    cancelRouteRequest();
    const request = routeSequenceRef.current;
    if (!origin) {
      setStatus(t("noOrigin"));
      return;
    }
    if (!dest) {
      setStatus(t("pickDestination"));
      return;
    }
    const m = modeRef.current;
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setStatus(null);
    fetch(
      `/api/crypto-map/directions?from=${origin[0]},${origin[1]}&to=${dest.lonlat[0]},${dest.lonlat[1]}&mode=${m}`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((res: RouteResult) => {
        if (request !== routeSequenceRef.current || mapRef.current !== map) return;
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
          steps: res.steps,
          coordinates: coords,
        });
        // Линия нарисована — лист стыкуется к низу экрана, иначе он закрывает
        // ровно то, за чем его открывали.
        setSheetExpanded(false);
        if (navControllerRef.current) {
          navControllerRef.current.updateRoute(coords);
          setNavOffRoute(null);
        }
        routeCoordsRef.current = coords;
        // Карточка стыкуется в этом же кадре — вписываем линию, когда её высота
        // уже известна браузеру.
        window.setTimeout(fitRoute, 160);
      })
      .catch((error: unknown) => {
        const aborted = (error as { name?: string } | null | undefined)?.name === "AbortError";
        if (aborted || request !== routeSequenceRef.current || mapRef.current !== map) return;
        setStatus(m === "transit" ? t("noTransit") : t("noRoute"));
      });
  }, [t, cancelRouteRequest]);

  // Точка назначения карточки: сводка прежнего маршрута гасится сразу, чтобы
  // в новой карточке не висели чужие километры, пока считается её маршрут.
  function routeTo(poi: Poi) {
    const key = `${poi.lon},${poi.lat}`;
    if (destKeyRef.current !== key) setRoute(null);
    destKeyRef.current = key;
    setDestKey(key);
    setRoutePoi(poi);
    destRef.current = { lonlat: [poi.lon, poi.lat], name: poi.name };
    if (originRef.current) buildRoute();
    else setStatus(t("noOrigin"));
  }

  function switchMode(next: RouteMode, poi?: Poi | null) {
    modeRef.current = next;
    setMode(next);
    // Режим переключают в карточке точки — значит пересчитывать надо маршрут
    // к ней, а не к тому, что лежало в destRef до неё.
    if (poi) routeTo(poi);
    else if (originRef.current && destRef.current) buildRoute();
  }

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
      setOriginState(lonlat);
      if (originMarkerRef.current) {
        originMarkerRef.current.setLngLat(lonlat);
      } else {
        const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat(lonlat).addTo(map);
        mk.on("dragend", () => {
          const ll = mk.getLngLat();
          const next: [number, number] = [ll.lng, ll.lat];
          originRef.current = next;
          setOriginState(next);
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
    const map = tryCreateMap({
      container: containerRef.current,
      style: basemapStyle(),
      center: PRAGUE,
      zoom: 13,
      pitch: 0,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    if (!map) {
      setMapUnavailable(true);
      return;
    }
    addStaticMapAttribution(map);
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    const geo = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    });
    geolocateRef.current = geo;
    map.addControl(geo, "top-right");
    geo.on("geolocate", (e: GeolocatePositionEvent) => {
      originRef.current = [e.coords.longitude, e.coords.latitude];
      setOriginState(originRef.current);
      // GeolocateControl shows its own blue dot — drop the manual orange pin.
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      setOriginLabel(t("posGps"));
      if (destRef.current) buildRoute();
    });

    map.on("load", () => {
      // Graft our two extra sources onto the fetched base style. The satellite
      // layer goes on first, so it sits above every base layer (an opaque raster
      // that hides the vector base when toggled on) and below the route/POI
      // layers added right after.
      map.addSource("satellite", SATELLITE_SOURCE);
      map.addSource("terrain", TERRAIN_SOURCE);
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } });

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

      // Один и тот же лист открывают и круги слоёв, и куратские логотипы:
      // карточка точки живёт в React (см. poi-sheet.tsx), а не в попапе карты.
      const openPoi = (poi: Poi) => {
        setSelected(poi);
        setSheetExpanded(true);
      };

      [...POI_LAYERS].reverse().forEach((layer) => {
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
          openPoi(featureToPoi(p, lonlat));
        });
      });

      mapReadyRef.current = true;
      applyDesiredMapState(map);

      // Click on empty map → drop/move the draggable "my position" pin.
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: POI_LAYERS.map((layer) => `poi-${layer}`),
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
          openPoi(curatedToPoi(c));
        });
      });

      loadPois();
    });

    const onMoveEnd = () => {
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(loadPois, 500);
      const c = map.getCenter();
      setMapCenter({ lat: c.lat, lon: c.lng });
    };
    map.on("moveend", onMoveEnd);

    return () => {
      navControllerRef.current?.stop();
      navControllerRef.current = null;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      mapReadyRef.current = false;
      poiSequenceRef.current += 1;
      poiAbortRef.current?.abort();
      poiAbortRef.current = null;
      cancelRouteRequest();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Control handlers ----
  function switchBase(next: Base) {
    const map = mapRef.current;
    baseRef.current = next;
    setBase(next);
    if (!map || !mapReadyRef.current) return;
    // The satellite raster covers the whole viewport, so showing it is enough to
    // hide the vector base underneath — no per-base-layer toggling needed.
    map.setLayoutProperty("satellite", "visibility", next === "satellite" ? "visible" : "none");
  }

  function toggle3D() {
    const map = mapRef.current;
    const next = !is3DRef.current;
    is3DRef.current = next;
    setIs3D(next);
    if (!map || !mapReadyRef.current) return;
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
    const next = !visibleRef.current[layer];
    visibleRef.current = { ...visibleRef.current, [layer]: next };
    setVisible(visibleRef.current);
    if (!map || !mapReadyRef.current) return;
    map.setLayoutProperty(`poi-${layer}`, "visibility", next ? "visible" : "none");
  }

  function toggleCoinOnly() {
    const map = mapRef.current;
    const next = !coinOnlyRef.current;
    coinOnlyRef.current = next;
    setCoinOnly(next);
    if (!map || !mapReadyRef.current) return;
    applyCoinOnlyFilter(map, next);
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
    cancelRouteRequest();
    setPendingStart(false);
    originRef.current = null;
    setOriginState(null);
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
    cancelRouteRequest();
    setPendingStart(false);
    destRef.current = null;
    destKeyRef.current = null;
    routeCoordsRef.current = [];
    setDestKey(null);
    setRoutePoi(null);
    setRoute(null);
    setStatus(null);
    (map?.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  // A browser without speech synthesis simply never shows the voice control.
  const voiceSupported = useSyncExternalStore(subscribeNever, hasSpeech, () => false);
  const isPhone = useSyncExternalStore(subscribePhone, isPhoneNow, () => false);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOnRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = locale;
        window.speechSynthesis.speak(utterance);
      } catch {
        // a browser that exposes the API but refuses to speak
      }
    },
    [locale],
  );

  function toggleVoice() {
    const next = !voiceOnRef.current;
    voiceOnRef.current = next;
    setVoiceOn(next);
    try {
      window.localStorage.setItem(VOICE_KEY, next ? "on" : "off");
    } catch {
      // storage blocked — the toggle still holds for this session
    }
    if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  const stopNavigation = useCallback(() => {
    navControllerRef.current?.stop();
    navControllerRef.current = null;
    setNavActive(false);
    setNavOffRoute(null);
    setNavRemaining(null);
    setNavStep(null);
    spokenRef.current = { index: -1, bands: new Set() };
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus(null);
    const map = mapRef.current;
    if (map) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, []);

  const startNavigation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !route) return;
    if (navControllerRef.current) return;
    // Карточка магазина посреди движения не нужна, а экран нужен весь.
    setSelected(null);

    setStatus(t("navStarting"));
    setNavError(null);

    const ctl = new NavigationController(route.coordinates);
    navControllerRef.current = ctl;

    // Maneuvers are placed along the route by distance travelled, which is what
    // the controller already measures — no second projection of the GPS fix.
    const steps = route.steps ?? [];
    const ends = cumulativeEnds(steps);
    spokenRef.current = { index: -1, bands: new Set() };
    const announce = (remainingMeters: number) => {
      if (steps.length === 0) return;
      const travelled = Math.max(0, route.distance - remainingMeters);
      const current = activeStep(travelled, ends);
      if (!current) return;
      setNavStep(current);
      // The maneuver to announce is the one that ENDS the step being travelled.
      const next = steps[current.index + 1];
      if (!next) return;
      if (spokenRef.current.index !== current.index) {
        spokenRef.current = { index: current.index, bands: new Set() };
      }
      const band = announcementBand(current.distanceToManeuver, route.mode);
      if (!band || spokenRef.current.bands.has(band)) return;
      spokenRef.current.bands.add(band);
      const instruction = maneuverText(next, t);
      speak(
        band === "now"
          ? instruction
          : t("nav.inDistance", {
              distance: spokenDistance(current.distanceToManeuver, t),
              instruction,
            }),
      );
    };

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
        announce(m);
      },
      onOffRoute: (dist) => {
        setNavOffRoute(dist);
      },
      onArrival: () => {
        setStatus(t("arrived"));
        speak(t("nav.arrive"));
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
  }, [route, t, stopNavigation, speak]);

  // «Поехали» на карточке без маршрута означает «построй и веди»: ведение
  // включается, когда ответ маршрутизатора пришёл.
  useEffect(() => {
    if (pendingStart && route) {
      setPendingStart(false);
      void startNavigation();
    }
  }, [pendingStart, route, startNavigation]);


  // Карта занимает весь экран телефона, пока идёт ведение или пока карточка
  // точки пристыкована к низу: иначе над листом видна полоса страницы, а не
  // карта с маршрутом — ровно то, на что жаловались. MapLibre смену размера
  // контейнера сам не замечает, поэтому размер пересчитывается явно и ещё раз
  // следующим кадром, когда класс уже применён.
  const mapFull = isPhone && (navActive || (!!selected && !sheetExpanded));
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.resize();
    const id = window.setTimeout(() => {
      mapRef.current?.resize();
      fitRoute();
    }, 80);
    return () => window.clearTimeout(id);
  }, [mapFull]);

  const btn = (active: boolean) =>
    "text-[12px] px-3 py-1.5 rounded-md font-medium transition-all " +
    (active ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground");

  return (
    <div className="bg-card border border-hairline rounded-[20px] p-4 md:p-6 space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => switchBase("map")} className={btn(base === "map")}>
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

      {/* Map */}
      <div className={mapFull ? "fixed inset-0 z-[55] bg-bg" : "relative"}>
        {mapUnavailable ? (
          <div
            role="status"
            className="w-full rounded-md border border-hairline bg-bg-tint px-4 py-10 text-center text-[13px] text-muted"
          >
            {t("mapUnavailable")}
          </div>
        ) : (
          <div
            ref={containerRef}
            className={
              mapFull
                ? "w-full h-full"
                : "w-full h-[420px] md:h-[520px] rounded-md overflow-hidden border border-hairline"
            }
          />
        )}
        {navActive && navStep && route?.steps?.[navStep.index + 1] && (
          <ManeuverBanner
            step={route.steps[navStep.index + 1]}
            distanceMeters={navStep.distanceToManeuver}
            t={t}
          />
        )}
        {tooFar && !navActive && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-card/95 border border-hairline rounded-full px-4 py-1.5 text-[12px] text-muted pointer-events-none">
            {t("zoomIn")}
          </div>
        )}
        {loading && (
          <div className="absolute bottom-3 left-3 bg-card/95 border border-hairline rounded-full px-3 py-1 text-[11px] text-muted pointer-events-none">
            {t("loading")}
          </div>
        )}
        {!selected && !navActive && <AvailableFintechPanel center={mapCenter} />}

        {selected && (
          <PoiSheet
            key={selected.id}
            poi={selected}
            locale={locale}
            route={destKey === `${selected.lon},${selected.lat}` ? route : null}
            mode={mode}
            status={status}
            hasOrigin={!!origin}
            near={!!origin && haversineMeters(origin, [selected.lon, selected.lat]) <= 150}
            navActive={navActive}
            voiceOn={voiceOn}
            voiceSupported={voiceSupported}
            expanded={sheetExpanded}
            onExpandedChange={setSheetExpanded}
            onClose={() => setSelected(null)}
            onMode={(m) => switchMode(m, selected)}
            onBuildRoute={() => routeTo(selected)}
            onGo={() => {
              if (route && destKey === `${selected.lon},${selected.lat}`) {
                void startNavigation();
                return;
              }
              routeTo(selected);
              setPendingStart(true);
            }}
            onClearRoute={clearRoute}
            onStreetView={() => setStreet({ lat: selected.lat, lon: selected.lon, name: selected.name })}
            onLocate={() => geolocateRef.current?.trigger()}
            onToggleVoice={toggleVoice}
            t={t}
          />
        )}

        {/* Ведение: всё управление движением — одной полосой под большим пальцем */}
        {navActive && (
          <div
            className="absolute inset-x-0 bottom-0 z-20 border-t border-hairline bg-card/95 px-3 pt-2.5 backdrop-blur"
            style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {navRemaining ? (
                  <>
                    <div className="num text-[16px] font-semibold leading-tight">
                      {navRemaining.m >= 1000
                        ? `${(navRemaining.m / 1000).toFixed(1)} km`
                        : `${Math.round(navRemaining.m)} m`}
                      {" · "}
                      {t("etaMin", { min: Math.max(1, Math.round(navRemaining.sec / 60)) })}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      {status ?? (navError ? navError : t("remaining"))}
                    </div>
                  </>
                ) : (
                  <div className="truncate text-[12px] text-muted">{status ?? t("navStarting")}</div>
                )}
              </div>
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  aria-pressed={voiceOn}
                  aria-label={voiceOn ? t("voiceOn") : t("voiceOff")}
                  title={voiceOn ? t("voiceOn") : t("voiceOff")}
                  className={
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-[17px] " +
                    (voiceOn ? "border-accent/50 bg-accent/10" : "border-hairline text-muted")
                  }
                >
                  {voiceOn ? "🔊" : "🔇"}
                </button>
              )}
              {navOffRoute !== null && navOffRoute > 30 && (
                <button
                  type="button"
                  onClick={() => buildRoute()}
                  className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-accent/50 bg-accent/10 px-3 text-[13px] font-medium text-foreground"
                >
                  ↻ {t("recompute")}
                </button>
              )}
              <button
                type="button"
                onClick={stopNavigation}
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-down px-4 text-[13px] font-semibold text-white"
              >
                ■ {t("stop")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend + counts */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleCoinOnly}
          title={t("coinOnlyHint")}
          className={
            "text-[12px] px-3 py-1.5 rounded-md border transition-all " +
            (coinOnly
              ? "bg-accent/15 text-accent border-accent/40"
              : "border-hairline text-muted hover:text-foreground")
          }
        >
          {coinOnly ? "✓ " : ""}{symbol.toUpperCase()} {t("coinOnly")}
        </button>
        {POI_LAYERS.map((layer) => (
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

      {/* Маршрут, когда карточка закрыта: куда и сколько, вернуться, очистить */}
      {!selected && !navActive && (route || status || navError) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3 text-[13px]">
          {route && (
            <>
              <span aria-hidden className="text-[15px]">
                {MODE_ICON[route.mode]}
              </span>
              <span className="text-muted">
                {t("duration")}:{" "}
                <span className="num text-foreground">
                  {t("etaMin", { min: Math.max(1, Math.round(route.duration / 60)) })}
                </span>
              </span>
              <span className="text-muted">
                {t("distance")}:{" "}
                <span className="num text-foreground">{(route.distance / 1000).toFixed(1)} km</span>
              </span>
              {routePoi && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(routePoi);
                    setSheetExpanded(false);
                  }}
                  className="min-h-[36px] rounded-xl border border-hairline px-3 text-[12px] font-medium text-foreground hover:border-accent"
                >
                  {t("openCard")}
                </button>
              )}
              <button
                type="button"
                onClick={clearRoute}
                className="min-h-[36px] text-[12px] text-muted underline hover:text-foreground"
              >
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

// MapLibre flattens feature properties, so `socials` arrives as a JSON string
// and the coordinates come from the geometry — not from the properties.
function featureToPoi(p: PoiProps, lonlat: [number, number]): Poi {
  return { ...p, lon: lonlat[0], lat: lonlat[1], socials: parseSocialProps(p.socials) };
}

// A curated business shows the same card as an OSM point: its logo doubles as
// the photo, and it is always coin-highlighted.
function curatedToPoi(c: CuratedPoi): Poi {
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
    socials: c.socials,
    image: c.logo,
    description: null,
  };
}
