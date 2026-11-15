"use client";

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import {
  type Map as MlMap,
  LngLatBounds,
  GeolocateControl,
  Marker,
  type SourceSpecification,
  type GeoJSONSource,
  type GeolocatePositionEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { useLocale, useTranslations } from "next-intl";
import type {
  AcceptedCoin,
  Poi,
  PoiLayer,
  RouteResult,
  RouteMode,
  RouteStep,
  GeoResult,
  Social,
} from "@/lib/crypto-map";
import { activeStep, cumulativeEnds } from "@/lib/route-steps";
import { VoiceLog, departureAnnouncement, nextAnnouncement } from "@/lib/nav-voice";
import {
  SpokenPhrases,
  departureCue,
  legSpans,
  nextTransitCue,
  transitCue,
  type LegSpan,
  type TransitCue,
} from "@/lib/transit-guidance";
import { cameraFor, isMoving } from "@/lib/nav-camera";
import { compassTap, type CompassMode } from "@/lib/compass-mode";
import { headingChanged, pickHeading } from "@/lib/heading";
import { requestCompassPermission, watchCompass } from "@/lib/compass-sensor";
import { createHeadingBeamElement } from "@/lib/heading-beam";
import { primeVoice, speakNav, cancelSpeech, speechAvailable } from "@/lib/speech";
import { speechLang } from "@/lib/locales";
import {
  MAP_FALLBACK_CENTER,
  MAP_FALLBACK_ZOOM,
  geolocationPermission,
  shouldAutoLocate,
} from "@/lib/map-start";

import {
  ManeuverBanner,
  maneuverText,
  spokenDistance,
} from "@/components/coin-detail/route-steps-panel";
import { TransitBanner, clockTime, transitCueText } from "@/components/coin-detail/transit-itinerary";
import { StreetViewOverlay } from "@/components/coin-detail/street-view-overlay";
import { MODE_ICON, PoiSheet, type SheetRoute } from "@/components/coin-detail/poi-sheet";
import { DEFAULT_POI_PAGE, type PoiPage } from "@/lib/poi-pager";
import { tileOffset, tilePadding } from "@/lib/poi-tile";
import { CURATED_POIS, type CuratedPoi } from "@/lib/curated-pois";
import { poiLogoSrc, showsLogoMarker } from "@/lib/poi-markers";
import { NavigationController, type NavigationCallbacks, type NavUpdate } from "./navigation-controller";
import { haversineMeters } from "@/lib/route-geometry";
import { MapControls } from "@/components/coin-detail/map-controls";
import { AvailableFintechPanel } from "@/components/fintech/available-fintech-panel";
import {
  addStaticMapAttribution,
  MAPLIBRE_ATTRIBUTION_OPTIONS,
} from "@/lib/maplibre-attribution";
import { tryCreateMap } from "@/lib/maplibre-map";
import { basemapStyle } from "@/lib/basemap";


// MapLibre flattens non-primitive feature properties to JSON strings, so `socials`
// rides through the GeoJSON source as a string and is parsed back when a popup opens.
// MapLibre сплющивает свойства фичи, поэтому всё составное едет строкой:
// `socials`, список принимаемых монет и фотографии.
type PoiProps = Omit<Poi, "socials" | "acceptedCoins" | "photos"> & {
  socials: string;
  acceptedCoins: string;
  photos: string;
};
type FilterSpecification = NonNullable<Parameters<MlMap["setFilter"]>[1]>;

const MIN_ZOOM = 11; // below this the bbox is too wide to return a useful number of points

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
const hasSpeech = () => speechAvailable();

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
/**
 * Насколько надо переехать, чтобы маршрут пересчитался сам.
 *
 * Городской GPS гуляет на десятки метров стоя на месте; пересчёт на каждом
 * таком отсчёте — это новый маршрут раз в секунду.
 */
const ORIGIN_MOVE_M = 60;

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
  // Метки-логотипы: элементы DOM рядом с полотном, а не слой карты. MapLibre
  // умеет значки, но только растровые и только с заголовком CORS, а знаки
  // заведений — это и svg, и чужие хосты. Поэтому метка живёт в DOM, а
  // фильтры слоёв к ней применяются руками.
  const logoMarkersRef = useRef<{ marker: Marker; poi: Poi; el: HTMLElement }[]>([]);
  const destKeyRef = useRef<string | null>(null);
  // Точка, из которой построен нынешний маршрут: по ней видно, переехал ли
  // человек настолько, что маршрут стоит считать заново.
  const lastRoutedOriginRef = useRef<[number, number] | null>(null);
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
  const [poiPage, setPoiPage] = useState<PoiPage>(DEFAULT_POI_PAGE);
  // Страница нужна и замыканиям (ответ маршрутизатора приходит через секунды),
  // поэтому она живёт и в ref: по ней видно, смотрит ли человек сейчас в окно
  // карты или в факты, где мерить плитку бессмысленно.
  const poiPageRef = useRef<PoiPage>(DEFAULT_POI_PAGE);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Окно карты мерит `fitRoute`: маршрут должен уместиться в него, а не уехать
  // под полосу управления или за край плитки.
  const mapTileRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [street, setStreet] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [navOffRoute, setNavOffRoute] = useState<number | null>(null);
  const [navRemaining, setNavRemaining] = useState<{ m: number; sec: number } | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  // Перестройка идёт отдельным признаком, а не строкой `status`: `buildRoute`
  // чистит `status` первым же делом, и надпись не успевала появиться.
  const [navRerouting, setNavRerouting] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [navStep, setNavStep] = useState<{ index: number; distanceToManeuver: number } | null>(null);
  // Подсказка транспорта: не манёвр, а нога — «идите до остановки», «садитесь
  // на метро A», «выходите на следующей». Границы ног по сшитой линии считаются
  // один раз на маршрут: на каждом отсчёте это была бы лишняя тригонометрия.
  const [navCue, setNavCue] = useState<TransitCue | null>(null);
  const navSpansRef = useRef<LegSpan[]>([]);
  const spokenRef = useRef(new SpokenPhrases());
  const [voiceOn, setVoiceOn] = useState(readVoicePreference);
  const voiceOnRef = useRef(voiceOn);
  // Что голос уже сказал. Не замыкание: пересчёт маршрута меняет манёвры, и
  // журнал обязан пережить замену маршрута, а не умереть вместе с ней.
  const voiceLogRef = useRef(new VoiceLog());
  // Маршрут, по которому идёт ведение ПРЯМО СЕЙЧАС. Прежде шаги жили в
  // замыкании `startNavigation`, и после пересчёта голос с баннером продолжали
  // вести по поворотам старого маршрута — ровно поэтому ручной «Пересчитать»
  // ничего и не чинил.
  const navRouteRef = useRef<SheetRoute | null>(null);
  const navControllerRef = useRef<NavigationController | null>(null);
  // `buildRoute` объявлен раньше голосовых помощников и держит их через ref —
  // иначе круг зависимостей: маршрут зовёт голос, голос пересобирает маршрут.
  const navDepartureRef = useRef<((r: SheetRoute) => void) | null>(null);
  // Tracked map center for the AvailableFintechPanel — debounced inside the panel.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  // Поворот и наклон карты видны компасу под ней: стрелка показывает, где
  // сейчас север, поэтому читается прямо из карты, а не хранится отдельно.
  const [view, setView] = useState({ bearing: 0, pitch: 0 });
  // Режим компаса и курс человека. Курс держится в ref, а не в состоянии:
  // отсчёты идут по нескольку раз в секунду, и перерисовывать ради них всю
  // страницу незачем — карту и луч двигает сам обработчик.
  const [compassMode, setCompassMode] = useState<CompassMode>("north");
  const compassModeRef = useRef<CompassMode>("north");
  const headingRef = useRef<number | null>(null);
  const appliedHeadingRef = useRef<number | null>(null);
  const gpsHeadingRef = useRef<number | null>(null);
  const gpsSpeedRef = useRef<number | null>(null);
  const compassHeadingRef = useRef<number | null>(null);
  const gpsPositionRef = useRef<[number, number] | null>(null);
  const beamRef = useRef<Marker | null>(null);
  const compassStopRef = useRef<(() => void) | null>(null);
  // No WebGL2 (or MapLibre failed to start): show a notice instead of the map.
  // mapRef then stays null, so every map handler below is a no-op.
  const [mapUnavailable, setMapUnavailable] = useState(false);

  /**
   * Новый отсчёт курса: луч у своей точки и, если включено слежение, поворот
   * карты. Зовётся и из геолокации карты, и из отсчётов ведения — источник
   * один и тот же GPS, просто читают его два разных потребителя.
   */
  const applyHeading = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = pickHeading({
      gpsHeading: gpsHeadingRef.current,
      speedMps: gpsSpeedRef.current,
      compassHeading: compassHeadingRef.current,
    });
    headingRef.current = next;

    const pos = gpsPositionRef.current;
    if (next === null || !pos) {
      beamRef.current?.remove();
      beamRef.current = null;
    } else {
      let beam = beamRef.current;
      if (!beam) {
        beam = new Marker({
          element: createHeadingBeamElement(),
          // Луч привязан к сторонам света: повернули карту — он продолжает
          // показывать ту же сторону, а не ту же сторону экрана.
          rotationAlignment: "map",
          pitchAlignment: "map",
        });
        // Координата — ДО `addTo`: метка без неё падает на первой же
        // перерисовке карты (живой прогон поймал `undefined.lng`), и метка
        // остаётся в разметке мёртвой.
        beam.setLngLat(pos);
        beam.addTo(map);
        beamRef.current = beam;
      }
      beam.setLngLat(pos);
      beam.setRotation(next);
    }

    if (compassModeRef.current !== "heading" || next === null) return;
    // Во время ведения карту крутит маршрут: едущему она и так показывает
    // дорогу вперёд, и два источника поворота спорили бы друг с другом.
    if (navControllerRef.current && isMoving(gpsSpeedRef.current ?? 0)) return;
    if (!headingChanged(appliedHeadingRef.current, next)) return;
    appliedHeadingRef.current = next;
    map.easeTo({ bearing: next, duration: 300 });
  }, []);

  const changePoiPage = useCallback((next: PoiPage) => {
    poiPageRef.current = next;
    setPoiPage(next);
  }, []);

  // Один и тот же лист открывают круги слоёв, метки-логотипы и куратские
  // точки: карточка точки живёт в React (см. poi-sheet.tsx), а не в попапе.
  const openPoi = useCallback(
    (poi: Poi) => {
      // Свежая точка всегда открывается на фактах: нажатие на неё — это
      // вопрос «что это за место», а не «как доехать».
      changePoiPage(DEFAULT_POI_PAGE);
      setMapExpanded(false);
      setSelected(poi);
    },
    [changePoiPage],
  );

  const cancelRouteRequest = useCallback(() => {
    routeSequenceRef.current += 1;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
  }, []);

  /**
   * Метка-логотип живёт в DOM, поэтому выключенный слой и фильтр «только
   * монета страницы» прячут её отдельно от кругов MapLibre.
   */
  const applyLogoMarkerVisibility = useCallback(() => {
    logoMarkersRef.current.forEach(({ poi, el }) => {
      const shown = showsLogoMarker(poi, {
        visible: visibleRef.current,
        coinOnly: coinOnlyRef.current,
      });
      el.style.display = shown ? "" : "none";
    });
  }, []);

  /** Метки точек со знаком заведения: собираются заново на каждый ответ фида. */
  const syncLogoMarkers = useCallback(
    (map: MlMap, pois: Poi[]) => {
      logoMarkersRef.current.forEach(({ marker }) => marker.remove());
      logoMarkersRef.current = pois.flatMap((poi) => {
        const src = poiLogoSrc(poi);
        if (!src) return [];
        const el = document.createElement("div");
        el.className = "cmap-poi-logo";
        // Кольцо остаётся цветом слоя: знак говорит, чьё это место, а цвет —
        // какое оно; терять второе ради первого незачем.
        el.style.borderColor = LAYER_COLOR[poi.layer] ?? LAYER_COLOR.merchant;
        el.title = poi.name;
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        el.append(img);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openPoi(poi);
        });
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat([poi.lon, poi.lat]).addTo(map);
        // Битый знак — это белый кружок ни о чём поверх точки: метка уходит, а
        // круг слоя под ней остаётся и говорит хотя бы вид места.
        img.addEventListener("error", () => marker.remove());
        return [{ marker, poi, el }];
      });
      applyLogoMarkerVisibility();
    },
    [openPoi, applyLogoMarkerVisibility],
  );

  function applyDesiredMapState(map: MlMap) {
    map.setLayoutProperty("satellite", "visibility", baseRef.current === "satellite" ? "visible" : "none");
    POI_LAYERS.forEach((layer) => {
      map.setLayoutProperty(`poi-${layer}`, "visibility", visibleRef.current[layer] ? "visible" : "none");
    });
    applyCoinOnlyFilter(map, coinOnlyRef.current);
    applyLogoMarkerVisibility();
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
            properties: {
              ...p,
              socials: JSON.stringify(p.socials),
              acceptedCoins: JSON.stringify(p.acceptedCoins),
              photos: JSON.stringify(p.photos),
            },
          })),
        });
        syncLogoMarkers(map, pois);
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
  }, [coinId, symbol, syncLogoMarkers]);

  // Та часть карты, которую видно: на телефоне это прямоугольник окна
  // карточки, каким бы оно сейчас ни было — плиткой в пропорции банковской
  // карты или раскрытым на весь экран. Одно правило на оба состояния: у
  // раскрытого прямоугольник просто больше. Когда человек смотрит не в окно, а
  // в факты или витрину, мерить нечего — страница карты уехала за край экрана.
  function mapWindowPadding() {
    const tile = isPhoneNow() && poiPageRef.current === "map" ? mapTileRef.current : null;
    const box = tile?.getBoundingClientRect();
    if (!box) return { top: 70, left: 24, right: 24, bottom: 60 };
    return tilePadding({
      tile: { top: box.top, left: box.left, width: box.width, height: box.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
  }

  function fitRoute() {
    const map = mapRef.current;
    const coords = routeCoordsRef.current;
    if (!map || coords.length === 0 || navControllerRef.current) return;
    const bounds = coords.reduce(
      (bb, c) => bb.extend(c),
      new LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, { padding: mapWindowPadding(), maxZoom: 16 });
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
    lastRoutedOriginRef.current = origin;
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
          endTime: res.endTime ?? null,
        });
        // Страницу здесь не трогаем намеренно. Ответ приходит через секунды
        // после нажатия, и прежний переброс на карту выбивал человека с
        // «Места» или витрины — ровно та жалоба, ради которой слайс и начат.
        if (navControllerRef.current) {
          navControllerRef.current.updateRoute(coords, res.mode);
          setNavOffRoute(null);
          // Манёвры нового маршрута, а не прежнего: баннер и голос читают их
          // отсюда. Без этой строки пересчёт вёл по старым поворотам.
          navRouteRef.current = {
            distance: res.distance,
            duration: res.duration,
            mode: res.mode,
            transfers: res.transfers,
            legs: res.legs,
            steps: res.steps,
            coordinates: coords,
            endTime: res.endTime ?? null,
          };
          navDepartureRef.current?.(navRouteRef.current);
          setNavRerouting(false);
        }
        routeCoordsRef.current = coords;
        // Вписываем линию следующим кадром: размеры окна карточки браузер
        // пересчитает после отрисовки сводки маршрута.
        window.setTimeout(fitRoute, 160);
      })
      .catch((error: unknown) => {
        const aborted = (error as { name?: string } | null | undefined)?.name === "AbortError";
        if (aborted || request !== routeSequenceRef.current || mapRef.current !== map) return;
        // Сорвавшаяся перестройка прежний маршрут не стирает: вести по
        // позавчерашней линии лучше, чем не вести вовсе.
        setNavRerouting(false);
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
    // Кнопка «Маршрут сюда» стоит на самой странице карты, так что человек уже
    // смотрит в окно: перелистывать за него нечего.
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
      center: MAP_FALLBACK_CENTER,
      zoom: MAP_FALLBACK_ZOOM,
      pitch: 0,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    if (!map) {
      setMapUnavailable(true);
      return;
    }
    addStaticMapAttribution(map);
    mapRef.current = map;

    // `NavigationControl` на карте больше не стоит: на телефоне его кнопки
    // закрывали собой окно, ради которого карту и открыли. Те же действия
    // живут под картой — см. `MapControls`.
    const geo = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    });
    geolocateRef.current = geo;
    map.addControl(geo, "top-right");
    geo.on("geolocate", (e: GeolocatePositionEvent) => {
      const next: [number, number] = [e.coords.longitude, e.coords.latitude];
      originRef.current = next;
      setOriginState(next);
      // Курс и скорость приходят тем же отсчётом: по ним рисуется луч у синей
      // точки, а в режиме слежения поворачивается и сама карта.
      gpsPositionRef.current = next;
      gpsHeadingRef.current = e.coords.heading ?? null;
      gpsSpeedRef.current = e.coords.speed ?? null;
      applyHeading();
      // GeolocateControl shows its own blue dot — drop the manual orange pin.
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      setOriginLabel(t("posGps"));
      // Маршрут здесь больше НЕ перестраивается на каждом отсчёте, и это
      // главная починка слайса. `trackUserLocation` шлёт событие раз в
      // секунду; прежний безусловный `buildRoute()` на каждом из них строил
      // новый маршрут, а новый маршрут произносил фразу отправления и
      // вписывал всю линию в экран. Отсюда и голос, повторяющий одно и то же
      // без остановки, и приближение, возвращающееся обратно, сколько его ни
      // меняй. Во время ведения перестройкой занимается контроллер; вне его
      // маршрут пересчитывается только на заметный переезд.
      if (navControllerRef.current) return;
      if (!destRef.current) return;
      const prev = lastRoutedOriginRef.current;
      if (prev && haversineMeters(prev, next) < ORIGIN_MOVE_M) return;
      buildRoute();
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

      // Карта открывается там, где человек стоит. Запрос идёт сам: «где я» —
      // первый вопрос, с которым заходят в навигатор, и заставлять ради него
      // искать кнопку незачем. Отказавшего не переспрашиваем — он останется в
      // городе по умолчанию, и кнопка «моё положение» никуда не делась.
      void geolocationPermission().then((state) => {
        if (!shouldAutoLocate(state)) return;
        if (mapRef.current !== map) return;
        try {
          geo.trigger();
        } catch {
          // контроль ещё не готов — кнопка остаётся человеку
        }
      });
    });

    const onView = () => setView({ bearing: map.getBearing(), pitch: map.getPitch() });
    map.on("rotate", onView);
    map.on("pitch", onView);

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
      logoMarkersRef.current.forEach(({ marker }) => marker.remove());
      logoMarkersRef.current = [];
      compassStopRef.current?.();
      compassStopRef.current = null;
      beamRef.current?.remove();
      beamRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Control handlers ----
  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 200 });
  }

  /**
   * Нажатие на компас. Решение принимает `compassTap`: повёрнутую пальцами
   * карту первое нажатие выпрямляет, и только второе включает слежение за
   * курсом — иначе выхода из повёрнутой карты не остаётся, кнопка-то одна.
   *
   * Разрешение на компас спрашивается прямо отсюда: на iOS его дают только из
   * жеста, из эффекта спросить нельзя.
   */
  function onCompass() {
    const map = mapRef.current;
    const decision = compassTap({
      mode: compassModeRef.current,
      bearing: map?.getBearing() ?? 0,
      pitch: map?.getPitch() ?? 0,
    });
    compassModeRef.current = decision.mode;
    setCompassMode(decision.mode);

    if (decision.mode === "north") {
      compassStopRef.current?.();
      compassStopRef.current = null;
      compassHeadingRef.current = null;
      appliedHeadingRef.current = null;
    }
    if (decision.straighten) {
      map?.easeTo({ bearing: 0, pitch: 0, duration: 400 });
      return;
    }

    void requestCompassPermission().then((granted) => {
      if (!granted || compassModeRef.current !== "heading" || compassStopRef.current) return;
      compassStopRef.current = watchCompass((deg) => {
        compassHeadingRef.current = deg;
        applyHeading();
      });
    });
    // Без своего положения курса не будет вовсе — просим его тем же нажатием.
    if (!gpsPositionRef.current) {
      try {
        geolocateRef.current?.trigger();
      } catch {
        // контроль ещё не готов — человек нажмёт «моё положение» сам
      }
    }
    applyHeading();
  }

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
    applyLogoMarkerVisibility();
    if (!map || !mapReadyRef.current) return;
    map.setLayoutProperty(`poi-${layer}`, "visibility", next ? "visible" : "none");
  }

  function toggleCoinOnly() {
    const map = mapRef.current;
    const next = !coinOnlyRef.current;
    coinOnlyRef.current = next;
    setCoinOnly(next);
    applyLogoMarkerVisibility();
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

  // Голос говорит на языке страницы: код локали интерфейса браузеру мало —
  // ему нужен полный тег, иначе он берёт случайный голос из семьи языка.
  const voiceLang = speechLang(locale);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOnRef.current) return;
      speakNav(text, voiceLang);
    },
    [voiceLang],
  );

  /**
   * Отпереть синтез речи. Зовётся только из обработчиков нажатия и только
   * синхронно: мобильный Safari разрешает первую фразу лишь внутри жеста, а
   * жест кончается на первом же уходе в микрозадачу.
   */
  const prime = useCallback(
    (text: string) => {
      if (!voiceOnRef.current) return;
      primeVoice(text, voiceLang);
    },
    [voiceLang],
  );

  /** Фраза манёвра: «через 300 метров поверните направо» или просто манёвр. */
  const phraseFor = useCallback(
    (step: RouteStep, distanceMeters: number, immediate: boolean) => {
      const instruction = maneuverText(step, t);
      return immediate
        ? instruction
        : t("nav.inDistance", { distance: spokenDistance(distanceMeters, t), instruction });
    },
    [t],
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
    // Включение посреди поездки — тоже жест, и единственный шанс отпереть
    // синтез тому, кто выехал с выключенным голосом.
    if (next) primeVoice(t("voiceOn"), voiceLang);
    else cancelSpeech();
  }

  const stopNavigation = useCallback(() => {
    navControllerRef.current?.stop();
    navControllerRef.current = null;
    navRouteRef.current = null;
    setNavActive(false);
    setNavOffRoute(null);
    setNavRemaining(null);
    setNavStep(null);
    setNavCue(null);
    setNavRerouting(false);
    voiceLogRef.current.reset();
    spokenRef.current.reset();
    cancelSpeech();
    setStatus(null);
    const map = mapRef.current;
    if (map) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600, offset: [0, 0] });
    }
  }, []);

  /**
   * Подсказка на этот отсчёт: баннер всегда, голос — когда полоса объявления
   * пройдена впервые. Полосы считаются от скорости, а не только от метров:
   * тридцать метров до поворота на 90 км/ч — это полторы секунды.
   */
  const announce = useCallback(
    (u: NavUpdate) => {
      const r = navRouteRef.current;
      if (!r) return;
      if (r.mode === "transit") {
        const legs = r.legs ?? [];
        const spans = navSpansRef.current;
        if (legs.length === 0 || spans.length !== legs.length) return;
        // Пройденное меряется от остатка той же линии, по которой разложены
        // ноги: сумма ног и число `distance` из ответа чуть разные, а линия
        // одна.
        const total = spans[spans.length - 1].end;
        const travelled = Math.max(0, total - u.remainingMeters);
        setNavCue(transitCue({ travelled, legs, spans }));
        const cue = nextTransitCue({
          travelled,
          legs,
          spans,
          speedMps: u.speedMps,
          log: voiceLogRef.current,
        });
        if (cue) {
          const text = transitCueText(cue.cue, t);
          if (spokenRef.current.claim(text)) speak(text);
        }
        return;
      }
      const steps = r.steps ?? [];
      if (steps.length === 0) return;
      const ends = cumulativeEnds(steps);
      // Пройденное меряется от конца: остаток считается по самой линии, а
      // сумма шагов приходит от маршрутизатора, и эти два числа чуть разные.
      const travelled = Math.max(0, r.distance - u.remainingMeters);
      const current = activeStep(travelled, ends);
      setNavStep(current);
      const a = nextAnnouncement({
        travelled,
        ends,
        steps,
        mode: r.mode,
        speedMps: u.speedMps,
        log: voiceLogRef.current,
      });
      if (a) speak(phraseFor(a.step, a.distanceMeters, a.band === "now"));
    },
    [speak, phraseFor, t],
  );

  /**
   * Камера ведения: центр на дороге, курс вдоль линии, высота от скорости.
   * У стоящего человека карта остаётся такой, какой он её настроил, —
   * `cameraFor` в этом случае не отдаёт ничего. Исключение одно: самый первый
   * отсчёт, иначе ведение начнётся не пойми где.
   */
  const firstFixRef = useRef(true);
  const driveCamera = useCallback((u: NavUpdate) => {
    const map = mapRef.current;
    if (!map) return;
    const force = firstFixRef.current;
    firstFixRef.current = false;
    const cam = cameraFor({
      position: u.position,
      snapped: u.snapped,
      routeBearing: u.routeBearing,
      gpsBearing: u.gpsBearing,
      speedMps: u.speedMps,
      offRouteMeters: u.offRouteMeters,
      viewportHeight: map.getContainer().clientHeight,
      force,
    });
    if (!cam) return;
    map.easeTo({
      center: cam.center,
      bearing: cam.bearing ?? map.getBearing(),
      zoom: cam.zoom,
      pitch: cam.pitch,
      offset: cam.offset,
      // Длительность под шаг отсчётов и линейный разгон: иначе анимации встают
      // в очередь и карта едет толчками.
      duration: 900,
      easing: (x: number) => x,
    });
  }, []);

  /**
   * Первая фраза нового маршрута — она же звучит, если ведение уже идёт.
   * У транспорта она не о манёвре, а о ноге: «идите триста метров до остановки
   * Staroměstská». Ровно она же отпирает синтез речи при нажатии «Поехали».
   */
  const departurePhrase = useCallback(
    (r: SheetRoute): string | null => {
      voiceLogRef.current.reset();
      spokenRef.current.reset();
      if (r.mode === "transit") {
        const legs = r.legs ?? [];
        const spans = legSpans(legs);
        navSpansRef.current = spans;
        const cue = departureCue(legs, spans, voiceLogRef.current);
        if (!cue) return null;
        setNavCue(cue);
        const text = transitCueText(cue, t);
        spokenRef.current.claim(text);
        return text;
      }
      const d = departureAnnouncement(r.steps ?? [], voiceLogRef.current);
      return d ? phraseFor(d.step, d.distanceMeters, false) : null;
    },
    [phraseFor, t],
  );

  const announceDeparture = useCallback(
    (r: SheetRoute) => {
      const phrase = departurePhrase(r);
      if (phrase) speak(phrase);
    },
    [speak, departurePhrase],
  );

  useEffect(() => {
    navDepartureRef.current = announceDeparture;
  }, [announceDeparture]);

  const startNavigation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !route) return;
    if (navControllerRef.current) return;
    // Карточка магазина посреди движения не нужна, а экран нужен весь.
    setSelected(null);

    // ВАЖНО: отпирание синтеза и первая фраза — здесь, до любого `await`.
    // Эта функция вызывается прямо из обработчика нажатия, и только пока стек
    // принадлежит жесту, мобильный Safari разрешает говорить.
    navRouteRef.current = route;
    const departure = departurePhrase(route);
    if (voiceOnRef.current) primeVoice(departure ?? t("navStarting"), voiceLang);

    const starting = t("navStarting");
    setStatus(starting);
    setNavError(null);

    firstFixRef.current = true;
    const ctl = new NavigationController(route.coordinates, route.mode);
    navControllerRef.current = ctl;

    const cb: NavigationCallbacks = {
      onUpdate: (u) => {
        driveCamera(u);
        gpsPositionRef.current = u.position;
        gpsHeadingRef.current = u.gpsBearing;
        gpsSpeedRef.current = u.speedMps;
        applyHeading();
        setNavRemaining({ m: u.remainingMeters, sec: u.etaSeconds });
        setNavOffRoute(u.offRouteMeters);
        // Гасим только «запускаю ведение»: прежний безусловный сброс стирал
        // и «вы приехали» — следующий же отсчёт приходил через секунду.
        setStatus((prev) => (prev === starting ? null : prev));
        if (u.offRouteMeters === null) announce(u);
      },
      onReroute: (pos) => {
        setNavRerouting(true);
        speak(t("nav.rerouting"));
        // Дальше работает то, что уже написано: новое «моё положение»
        // перестраивает маршрут, а `buildRoute` отдаёт его контроллеру.
        setOrigin(pos, t("posGps"), false);
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
    await ctl.start(cb);
  }, [
    route,
    t,
    voiceLang,
    stopNavigation,
    speak,
    departurePhrase,
    announce,
    driveCamera,
    setOrigin,
    applyHeading,
  ]);

  // «Поехали» на карточке без маршрута означает «построй и веди»: ведение
  // включается, когда ответ маршрутизатора пришёл.
  useEffect(() => {
    if (pendingStart && route) {
      setPendingStart(false);
      void startNavigation();
    }
  }, [pendingStart, route, startNavigation]);


  // Карта занимает весь экран телефона, пока открыта карточка точки или идёт
  // ведение: карточка — листалка на весь экран, и её страница «Карта» должна
  // смотреть в карту, а не в кусок страницы. Полустояния листа больше нет.
  // MapLibre смену размера контейнера сам не замечает, поэтому размер
  // пересчитывается явно и ещё раз следующим кадром, когда класс уже применён.
  const mapFull = isPhone && (navActive || !!selected);
  // Следующий манёвр: он же — признак, что над картой стоит строка подсказки.
  const maneuverStep =
    navActive && navStep && route?.mode !== "transit"
      ? (route?.steps?.[navStep.index + 1] ?? null)
      : null;
  // В транспорте над картой стоит та же строка, но говорит она о ноге поездки.
  const transitRow = navActive && route?.mode === "transit" ? navCue : null;
  // Строка подсказки отнимает у полотна свою высоту, а MapLibre смену размера
  // контейнера сам не замечает — тот же пересчёт, что и при переходе в полный
  // экран.
  const hasManeuverRow = !!maneuverStep || !!transitRow;
  useEffect(() => {
    if (!mapRef.current) return;
    const id = window.setTimeout(() => mapRef.current?.resize(), 60);
    return () => window.clearTimeout(id);
  }, [hasManeuverRow]);
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.resize();
    const id = window.setTimeout(() => {
      mapRef.current?.resize();
      fitRoute();
    }, 80);
    return () => window.clearTimeout(id);
  }, [mapFull]);

  // Пока маршрута нет, в окне карточки должна быть видна сама точка — иначе
  // человек смотрит в кусок города. Окно меньше экрана, поэтому центр карты
  // сдвигается в середину окна, а не полотна; маршрут вписывает `fitRoute`.
  useEffect(() => {
    if (!isPhone || !selected || poiPage !== "map") return;
    const id = window.setTimeout(() => {
      const map = mapRef.current;
      const box = mapTileRef.current?.getBoundingClientRect();
      if (!map || !box || navControllerRef.current) return;
      if (routeCoordsRef.current.length) {
        fitRoute();
        return;
      }
      map.easeTo({
        center: [selected.lon, selected.lat],
        offset: tileOffset({
          tile: { top: box.top, left: box.left, width: box.width, height: box.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
        duration: 400,
      });
    }, 120);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone, selected, poiPage, mapExpanded]);

  /**
   * Остаток времени в транспорте — из расписания, а не из темпа хода.
   * Полоса ведения делит остаток линии на измеренный темп, и в метро это
   * бессмыслица: темп измерен пешком, а до выхода тридцать километров.
   */
  const transitArrival =
    route?.mode === "transit" && route.endTime && clockTime(route.endTime, locale)
      ? t("arriveBy", { time: clockTime(route.endTime, locale) as string })
      : null;

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
      <div className={mapFull ? "fixed inset-0 z-[55] flex flex-col bg-bg" : "relative"}>
        {/* Куда поворачивать — строкой НАД картой, а не поверх неё. Прежде
            баннер лежал на карте и закрывал собой ровно тот перекрёсток, к
            которому вёл. Своя строка короче карты не делает ничего другого:
            полотно просто начинается под ней. */}
        {(maneuverStep || transitRow) && (
          <div
            className={
              mapFull
                ? "shrink-0 border-b border-hairline bg-card px-3 pb-2 pt-3"
                : "mb-2"
            }
            style={mapFull ? { paddingTop: "max(0.75rem, env(safe-area-inset-top))" } : undefined}
          >
            {transitRow ? (
              <TransitBanner cue={transitRow} t={t} />
            ) : (
              maneuverStep && (
                <ManeuverBanner
                  step={maneuverStep}
                  distanceMeters={navStep?.distanceToManeuver ?? 0}
                  t={t}
                />
              )
            )}
          </div>
        )}
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
            // `relative` — не украшение: полотно MapLibre внутри позиционировано
            // абсолютно, и без своего начала отсчёта оно растягивалось на весь
            // `fixed`-экран, накрывая собой строку подсказки над картой.
            className={
              mapFull
                ? "relative w-full min-h-0 flex-1 overflow-hidden"
                : "relative w-full h-[420px] md:h-[520px] rounded-md overflow-hidden border border-hairline"
            }
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

        {selected && !navActive && (
          <PoiSheet
            key={selected.id}
            poi={selected}
            locale={locale}
            route={destKey === `${selected.lon},${selected.lat}` ? route : null}
            mode={mode}
            status={status}
            hasOrigin={!!origin}
            near={!!origin && haversineMeters(origin, [selected.lon, selected.lat]) <= 150}
            voiceOn={voiceOn}
            voiceSupported={voiceSupported}
            page={poiPage}
            onPageChange={changePoiPage}
            mapExpanded={mapExpanded}
            onMapExpandedChange={setMapExpanded}
            mapTileRef={mapTileRef}
            onClose={() => setSelected(null)}
            onMode={(m) => switchMode(m, selected)}
            onBuildRoute={() => routeTo(selected)}
            onGo={() => {
              if (route && destKey === `${selected.lon},${selected.lat}`) {
                // Синхронно из нажатия: `startNavigation` сама отпирает голос
                // первой фразой, пока стек ещё принадлежит жесту.
                void startNavigation();
                return;
              }
              // Маршрута ещё нет — ведение включит эффект, когда придёт ответ
              // маршрутизатора. Это уже не жест, поэтому голос отпирается
              // здесь и сейчас, иначе на айфоне он промолчит всю поездку.
              prime(t("navStarting"));
              routeTo(selected);
              setPendingStart(true);
            }}
            onClearRoute={clearRoute}
            onStreetView={() => setStreet({ lat: selected.lat, lon: selected.lon, name: selected.name })}
            onLocate={() => geolocateRef.current?.trigger()}
            onToggleVoice={toggleVoice}
            view={view}
            compassMode={compassMode}
            onZoomIn={() => zoomBy(1)}
            onZoomOut={() => zoomBy(-1)}
            onCompass={onCompass}
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
                      {transitArrival ?? t("etaMin", { min: Math.max(1, Math.round(navRemaining.sec / 60)) })}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      {navRerouting ? t("rerouting") : (status ?? navError ?? t("remaining"))}
                    </div>
                  </>
                ) : (
                  <div className="truncate text-[12px] text-muted">
                    {navRerouting ? t("rerouting") : (status ?? t("navStarting"))}
                  </div>
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

      {/* Масштаб и компас — под картой, кнопками под палец */}
      <MapControls
        bearing={view.bearing}
        pitch={view.pitch}
        compassMode={compassMode}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onCompass={onCompass}
        t={t}
      />

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
                    // Человек просил карточку, а не карту: открываем на фактах,
                    // как и всякую другую.
                    changePoiPage(DEFAULT_POI_PAGE);
                    setMapExpanded(false);
                    setSelected(routePoi);
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

function parseArrayProp<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string" && raw) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// MapLibre flattens feature properties, so every composite field arrives as a
// JSON string and the coordinates come from the geometry — not the properties.
function featureToPoi(p: PoiProps, lonlat: [number, number]): Poi {
  return {
    ...p,
    lon: lonlat[0],
    lat: lonlat[1],
    // MapLibre пустое свойство отдаёт как undefined, а карточка ждёт `null`.
    logoUrl: typeof p.logoUrl === "string" && p.logoUrl ? p.logoUrl : null,
    socials: parseArrayProp<Social>(p.socials),
    acceptedCoins: parseArrayProp<AcceptedCoin>(p.acceptedCoins),
    photos: parseArrayProp<string>(p.photos),
  };
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
    // Куратский список заведён под монету страницы, именами монет он не
    // торгует — поэтому чипсов нет, а не выдуманный тикер.
    acceptedCoins: [],
    acceptedGeneric: true,
    photos: [],
    website: c.website,
    openingHours: null,
    phone: c.phone,
    email: c.email,
    socials: c.socials,
    image: c.logo,
    logoUrl: c.logo,
    description: null,
  };
}
