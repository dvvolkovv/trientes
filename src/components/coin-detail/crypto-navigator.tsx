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
import { StopVoiceLog, stopCue, type MarkedStop } from "@/lib/route-stop-cue";
import { compassTap, type CompassMode } from "@/lib/compass-mode";
import { headingChanged, pickHeading } from "@/lib/heading";
import { requestCompassPermission, watchCompass } from "@/lib/compass-sensor";
import { createHeadingBeamElement } from "@/lib/heading-beam";
import { primeVoice, speakNav, cancelSpeech, speechAvailable } from "@/lib/speech";
import { speechLang } from "@/lib/locales";
import {
  geolocationPermission,
  shouldAutoLocate,
  startView,
  type MapArea,
  type MapFocus,
} from "@/lib/map-start";

import {
  ManeuverBanner,
  maneuverText,
  spokenDistance,
} from "@/components/coin-detail/route-steps-panel";
import { TransitBanner, clockTime, transitCueText } from "@/components/coin-detail/transit-itinerary";
import { StreetViewOverlay } from "@/components/coin-detail/street-view-overlay";
import { RouteStopsPanel, type StopRow } from "@/components/coin-detail/route-stops-panel";
import { MODE_ICON, PoiSheet, type SheetRoute } from "@/components/coin-detail/poi-sheet";
import { DEFAULT_POI_PAGE, type PoiPage } from "@/lib/poi-pager";
import { tileOffset, tilePadding } from "@/lib/poi-tile";
import { CURATED_POIS, type CuratedPoi } from "@/lib/curated-pois";
import { poiLogoSrc, showsLogoMarker } from "@/lib/poi-markers";
import { buildLogoMarkerElement } from "@/lib/logo-marker";
import { NavigationController, type NavigationCallbacks, type NavUpdate } from "./navigation-controller";
import { haversineMeters } from "@/lib/route-geometry";
import { MapControls } from "@/components/coin-detail/map-controls";
import { AvailableNearPanel } from "@/components/coin-detail/available-near-panel";
import { POI_LAYERS, LAYER_COLOR } from "@/lib/poi-layers";
import {
  BRAND_COLOR,
  poiBrand,
  poiPulseColor,
  pulseFrame,
  PULSE_PERIOD_MS,
} from "@/lib/poi-brand";
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

/**
 * Дыхание середины булавки. Кадры считает чистая `pulseFrame`, а здесь только
 * ход времени и две записи свойств на слой.
 *
 * Два решения, которые стоит помнить. Первое: кадров **пятнадцать в секунду**,
 * а не шестьдесят — каждая запись свойства заставляет MapLibre перерисовать
 * карту целиком, и на телефоне шестьдесят перерисовок в секунду греют батарею
 * ради огонька, который и так дышит медленно. Второе: при включённом
 * «уменьшить движение» пульса нет вовсе — точка просто стоит в середине своего
 * размера; человеку, которому анимация мешает, мы её не навязываем.
 */
let pulseRaf: number | null = null;

function stopPulse() {
  if (pulseRaf !== null) cancelAnimationFrame(pulseRaf);
  pulseRaf = null;
}

function applyPulseFrame(map: MlMap, phase: number) {
  const frame = pulseFrame(phase);
  POI_LAYERS.forEach((layer) => {
    const id = `poi-${layer}-core`;
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, "circle-radius", frame.radius);
    map.setPaintProperty(id, "circle-opacity", frame.opacity);
  });
}

function startPulse(map: MlMap) {
  stopPulse();
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    applyPulseFrame(map, 0.5);
    return;
  }
  const started = performance.now();
  let lastDraw = 0;
  const step = (now: number) => {
    // Карту убрали из-под нас (переход на другую страницу) — молча выходим.
    if (!map.getLayer(`poi-${POI_LAYERS[0]}-core`)) {
      pulseRaf = null;
      return;
    }
    if (now - lastDraw >= 1000 / 15) {
      lastDraw = now;
      applyPulseFrame(map, ((now - started) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS);
    }
    pulseRaf = requestAnimationFrame(step);
  };
  pulseRaf = requestAnimationFrame(step);
}

function applyCoinOnlyFilter(map: MlMap, coinOnly: boolean) {
  POI_LAYERS.forEach((layer) => {
    const base: FilterSpecification = ["==", ["get", "layer"], layer];
    const filter: FilterSpecification = coinOnly
      ? (["all", base, ["==", ["get", "coinSpecific"], true]] as FilterSpecification)
      : base;
    map.setFilter(`poi-${layer}`, filter);
    // Середина булавки — отдельный слой, и фильтры к нему применяются теми же
    // правилами: иначе выключенный слой оставлял бы на карте свои огоньки.
    map.setFilter(`poi-${layer}-core`, filter);
  });
}

export default function CryptoNavigator({
  coinId,
  symbol,
  coinName,
  focus = null,
  area = null,
  productSlug = null,
}: {
  coinId: string;
  symbol: string;
  coinName: string;
  /** Точка из адреса: карта открывается на ней, а её карточка — сама. */
  focus?: MapFocus | null;
  /** Где эту монету принимают: карта садится на все точки сразу. */
  area?: MapArea | null;
  /**
   * Фильтр по товару (слайс BC): фид отдаёт только свои точки, где он лежит на полке.
   * Монета при этом не фильтрует — человек ищет товар, а не способ оплаты.
   */
  productSlug?: string | null;
}) {
  const t = useTranslations("cryptoMap");
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  /** Наблюдатель за тем, видно ли карту: пульс дышит только на экране. */
  const pulseWatchRef = useRef<IntersectionObserver | null>(null);
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
  /** Знак места из адреса (`focus.mark`): ставится один раз, фильтры его не касаются. */
  const focusMarkRef = useRef<Marker | null>(null);
  const destKeyRef = useRef<string | null>(null);
  // Точка, из которой построен нынешний маршрут: по ней видно, переехал ли
  // человек настолько, что маршрут стоит считать заново.
  const lastRoutedOriginRef = useRef<[number, number] | null>(null);
  const routeCoordsRef = useRef<[number, number][]>([]);
  // Карточку названной точки раскрываем ровно один раз: фид приходит на каждое
  // движение карты, и без этого признака карточка вскакивала бы обратно каждый
  // раз, когда человек её закрыл и подвинул карту.
  const focusOpenedRef = useRef(false);

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
  // Перечень найденных адресов. Прежде страница брала `results[0]` и улетала
  // туда картой — сколько бы домов геокодер ни нашёл, человек видел один, и
  // не тот, который искал. Поэтому список есть, и выбирает из него человек.
  const [searchResults, setSearchResults] = useState<GeoResult[] | null>(null);
  // Чем на самом деле искали: кириллический запрос уходит в геокодер
  // латиницей, и без этой строки непонятно, почему ответ не похож на буквы.
  const [searchedAs, setSearchedAs] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<RouteMode>("walk");
  const [route, setRoute] = useState<SheetRoute | null>(null);
  // К какой точке построен маршрут. Карточка другой точки не должна показывать
  // чужую сводку как свою, поэтому сверяется ключ, а не наличие маршрута.
  const [destKey, setDestKey] = useState<string | null>(null);
  const [routePoi, setRoutePoi] = useState<Poi | null>(null);
  /**
   * Отмеченные точки по пути (ТЗ 4.4). Живут в браузере, а не в базе: это поездка, а
   * не коллекция, а навигатор нарочно работает и без входа. Ключ — цель маршрута,
   * поэтому перезагрузка страницы посреди дороги отметки не теряет.
   */
  const [marked, setMarked] = useState<MarkedStop[]>([]);
  const [marksFor, setMarksFor] = useState<string | null>(null);
  const markedRef = useRef<MarkedStop[]>([]);
  const alertMetersRef = useRef(1500);
  const stopLogRef = useRef(new StopVoiceLog());
  const [stopHint, setStopHint] = useState<string | null>(null);
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
  // Центр карты и страна, в которой он лежит. Страну определяет обратное
  // геокодирование (оно кэшировано на сервере), и она нужна сразу двум
  // местам: полосе «Доступно в стране» над картой и поиску адреса — без
  // `countrycodes` Nominatim ранжирует по мировой важности и страну, в
  // которой человек стоит, не показывает вовсе.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [centerCc, setCenterCc] = useState<string | null>(null);
  const ccRequestRef = useRef<string | null>(null);
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
    (poi: Poi, page: PoiPage = DEFAULT_POI_PAGE) => {
      // Свежая точка всегда открывается на фактах: нажатие на неё — это
      // вопрос «что это за место», а не «как доехать». Исключение — точка,
      // названная в адресе: её открывали ссылкой «где именно», и ответ на
      // этот вопрос лежит на странице карты.
      changePoiPage(page);
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
        if (!poiLogoSrc(poi)) return [];
        // Кольцо — фирменного цвета источника, как у булавки: знак говорит,
        // чьё это место, а цвет — насколько мы за него отвечаем.
        const { el, img } = buildLogoMarkerElement({
          logoUrl: poi.logoUrl,
          label: poi.name,
          ringColor: BRAND_COLOR[poiBrand(poi)],
        });
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openPoi(poi);
        });
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat([poi.lon, poi.lat]).addTo(map);
        // Битый знак — это белый кружок ни о чём поверх точки: метка уходит, а
        // круг слоя под ней остаётся и говорит хотя бы вид места.
        img?.addEventListener("error", () => marker.remove());
        return [{ marker, poi, el }];
      });
      applyLogoMarkerVisibility();
    },
    [openPoi, applyLogoMarkerVisibility],
  );

  function applyDesiredMapState(map: MlMap) {
    map.setLayoutProperty("satellite", "visibility", baseRef.current === "satellite" ? "visible" : "none");
    POI_LAYERS.forEach((layer) => {
      const vis = visibleRef.current[layer] ? "visible" : "none";
      map.setLayoutProperty(`poi-${layer}`, "visibility", vis);
      map.setLayoutProperty(`poi-${layer}-core`, "visibility", vis);
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
    const productQuery = productSlug ? `&product=${encodeURIComponent(productSlug)}` : "";
    fetch(`/api/crypto-map/poi?bbox=${bbox}&coin=${encodeURIComponent(coinId)}&symbol=${encodeURIComponent(symbol)}&locale=${encodeURIComponent(locale)}${productQuery}`, {
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
              // Цвет булавки говорит, кто за точкой стоит: наше предприятие,
              // учреждение каталога или зеркало BTC Map (см. poi-brand).
              brand: poiBrand(p),
              // Цвет середины — что это за место (магазин, банкомат, заправка).
              pulse: poiPulseColor(p),
              socials: JSON.stringify(p.socials),
              acceptedCoins: JSON.stringify(p.acceptedCoins),
              photos: JSON.stringify(p.photos),
            },
          })),
        });
        syncLogoMarkers(map, pois);
        // Точка из адреса: карта уже стоит на ней, осталось раскрыть карточку.
        // Ждём именно фида, а не строим карточку из своих данных — у точки в
        // фиде есть всё: фото, часы, принимаемые монеты, связь.
        if (focus && !focusOpenedRef.current) {
          const target = pois.find((p) => p.id === focus.id);
          if (target) {
            focusOpenedRef.current = true;
            openPoi(target, "map");
          }
        }
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
  }, [coinId, symbol, syncLogoMarkers, focus, openPoi]);

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
    else {
      // Откуда — не вопрос к человеку, пока его не спросили у браузера.
      // Пришедший по ссылке «где именно» своего положения ещё не называл: ради
      // названной точки карта его не запрашивала. Отсчёт придёт — и обработчик
      // геолокации достроит маршрут сам, цель уже назначена.
      setStatus(t("noOrigin"));
      try {
        geolocateRef.current?.trigger();
      } catch {
        // контроль не готов или в разрешении отказано — надпись остаётся
      }
    }
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
    // `bounds` в конструкторе MapLibre важнее center/zoom, поэтому вид
    // раскладывается целиком: одно поле на оба случая, промежуточного кадра в
    // Мадриде человек не увидит.
    const map = tryCreateMap({
      container: containerRef.current,
      style: basemapStyle(),
      pitch: 0,
      ...startView(focus, area),
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
        // Булавка собрана из двух слоёв: каёмка (кто за точкой стоит) и
        // пульсирующая середина (что это за место). Разделение нужно потому,
        // что середина дышит, а каёмка стоит неподвижно.
        map.addLayer({
          id: `poi-${layer}`,
          type: "circle",
          source: "pois",
          filter: ["==", ["get", "layer"], layer],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 10],
            // Тёмная подложка, а не прозрачность: на светлой карте белая
            // каёмка иначе теряется, а нажатие должно попадать в круг целиком.
            "circle-color": "#10131A",
            // Подложка нарочно бледная: на светлой карте плотный тёмный диск
            // читается как клякса, а нам нужно кольцо с огоньком внутри.
            "circle-opacity": 0.26,
            // Каёмка — источник точки: оранжевая у наших, серая у каталога,
            // белая у зеркала BTC Map.
            "circle-stroke-color": [
              "match",
              ["get", "brand"],
              "own", BRAND_COLOR.own,
              "institution", BRAND_COLOR.institution,
              BRAND_COLOR.osm,
            ],
            // Толще — значит здесь принимают выбранную монету.
            "circle-stroke-width": ["case", ["get", "coinSpecific"], 3.2, 1.8],
            "circle-stroke-opacity": ["case", ["get", "coinSpecific"], 1, 0.8],
          },
        });

        map.addLayer({
          id: `poi-${layer}-core`,
          type: "circle",
          source: "pois",
          filter: ["==", ["get", "layer"], layer],
          paint: {
            // Радиус и прозрачность задаёт кадр пульса (pulseFrame);
            // здесь — начальные значения, дальше их меняет анимация.
            "circle-radius": pulseFrame(0).radius,
            "circle-color": ["coalesce", ["get", "pulse"], "#30B658"],
            "circle-opacity": pulseFrame(0).opacity,
            "circle-stroke-width": 0,
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

      // Место, ради которого карту открыли, но которого нет в фиде: у места
      // рекламного материала строки `Poi` не бывает (BZ), и карта вставала на
      // координате вообще без отметки. Знак предприятия и говорит, чьё это
      // место, — тот же кружок, что у точек приёма.
      if (focus?.mark) {
        const { el, img } = buildLogoMarkerElement({
          logoUrl: focus.mark.logoUrl,
          label: focus.mark.label,
          ringColor: BRAND_COLOR.own,
          href: focus.mark.href,
        });
        const mk = new Marker({ element: el, anchor: "center" }).setLngLat([focus.lon, focus.lat]).addTo(map);
        // Битый знак метку не убирает: под ней, в отличие от точки приёма, нет
        // круга слоя — убери её, и место осталось бы ничем не отмечено.
        img?.addEventListener("error", () => {
          img.remove();
          el.textContent = focus.mark!.label.trim().slice(0, 1).toUpperCase();
        });
        focusMarkRef.current = mk;
      }

      mapReadyRef.current = true;
      applyDesiredMapState(map);
      startPulse(map);
      // Карту, уехавшую за край экрана, перерисовывать незачем: на странице
      // монеты навигатор лежит ниже сгиба, и пульс там жёг бы батарею впустую.
      if (typeof IntersectionObserver !== "undefined" && containerRef.current) {
        pulseWatchRef.current?.disconnect();
        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) startPulse(map);
            else stopPulse();
          },
          { threshold: 0 },
        );
        io.observe(containerRef.current);
        pulseWatchRef.current = io;
      }

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
        if (!shouldAutoLocate(state, !!focus || !!area)) return;
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
      focusMarkRef.current?.remove();
      focusMarkRef.current = null;
      compassStopRef.current?.();
      compassStopRef.current = null;
      pulseWatchRef.current?.disconnect();
      pulseWatchRef.current = null;
      stopPulse();
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
    map.setLayoutProperty(`poi-${layer}-core`, "visibility", next ? "visible" : "none");
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

  // Страна центра карты. Сдвиг карты на сотню метров страну не меняет,
  // поэтому запрос идёт с задержкой и только когда центр уехал заметно: по
  // четвёртому знаку координаты (≈11 м) ответ всё равно кэширован на сервере.
  useEffect(() => {
    if (!mapCenter) return;
    const key = `${mapCenter.lat.toFixed(2)},${mapCenter.lon.toFixed(2)}`;
    if (ccRequestRef.current === key) return;
    const timer = setTimeout(() => {
      ccRequestRef.current = key;
      fetch(`/api/crypto-map/geocode?lat=${mapCenter.lat}&lon=${mapCenter.lon}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { result?: { countryCode?: string } } | null) => {
          const cc = j?.result?.countryCode;
          if (cc) setCenterCc(cc);
        })
        .catch(() => {
          // страна неизвестна — поиск просто идёт по миру, как раньше
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [mapCenter]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setStatus(null);
    setSearching(true);
    setSearchResults(null);
    setSearchedAs(null);
    const params = new URLSearchParams({ q, lang: locale });
    // Страна центра карты — тот самый рычаг, без которого перечня нет.
    if (centerCc) params.set("cc", centerCc);
    fetch(`/api/crypto-map/geocode?${params.toString()}`)
      .then((r) => r.json())
      .then((res: { results?: GeoResult[]; queried?: string }) => {
        const found = res.results ?? [];
        setSearchResults(found);
        setSearchedAs(res.queried && res.queried !== q ? res.queried : null);
        if (found.length === 0) setStatus(t("notFound"));
      })
      .catch(() => {
        setSearchResults([]);
        setStatus(t("notFound"));
      })
      .finally(() => setSearching(false));
  }

  // Выбор строки из перечня: булавка туда, карта туда, список закрыт.
  function pickSearchResult(hit: GeoResult) {
    const map = mapRef.current;
    const lonlat: [number, number] = [hit.lon, hit.lat];
    setOrigin(lonlat, hit.title ? [hit.title, hit.subtitle].filter(Boolean).join(", ") : hit.label, false);
    setSearchResults(null);
    setSearchedAs(null);
    map?.flyTo({ center: lonlat, zoom: 16 });
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
  // Отметки читаются и пишутся по цели маршрута: другая цель — другая поездка.
  const marksKey = destKey ? `cmap:stops:v1:${destKey}` : null;
  // Смена цели — это производное состояние, и оно считается при отрисовке, а не
  // эффектом: отметки нужны той же отрисовке, что рисует панель, и один лишний проход
  // здесь означал бы панель с чужими отметками в первом кадре.
  if (marksFor !== marksKey) {
    setMarksFor(marksKey);
    setMarked(readMarks(marksKey));
  }
  // Голос читает отметки из ссылки, а не из состояния: ведение считает подсказку в
  // обработчике отсчёта GPS, которому отрисовка ничего не передаёт.
  useEffect(() => {
    markedRef.current = marked;
  }, [marked]);
  useEffect(() => {
    // Новая цель — новые фразы: о точке прежней поездки говорить незачем.
    stopLogRef.current = new StopVoiceLog();
  }, [marksKey]);

  const toggleMark = useCallback(
    (stop: StopRow) => {
      setMarked((prev) => {
        const next = prev.some((m) => m.id === stop.poi.id)
          ? prev.filter((m) => m.id !== stop.poi.id)
          : [
              ...prev,
              {
                id: stop.poi.id,
                name: stop.poi.name,
                alongMeters: stop.alongMeters,
                offsetMeters: stop.offsetMeters,
              },
            ];
        try {
          if (marksKey) window.localStorage.setItem(marksKey, JSON.stringify(next));
        } catch {
          // Приватный режим браузера — отметка живёт до перезагрузки, и это лучше отказа.
        }
        return next;
      });
    },
    [marksKey],
  );

  /**
   * Расстояние вдоль маршрута у отмеченной точки считает сервер по той линии, которую
   * он получил. Пересчёт на ходу эти числа обновляет: иначе «через полтора километра»
   * относилось бы к прежней дороге.
   */
  const onStops = useCallback(
    (stops: StopRow[], alertMeters: number) => {
      alertMetersRef.current = alertMeters;
      if (markedRef.current.length === 0) return;
      const fresh = new Map(stops.map((s) => [s.poi.id, s]));
      setMarked((prev) =>
        prev.map((m) => {
          const row = fresh.get(m.id);
          return row ? { ...m, alongMeters: row.alongMeters, offsetMeters: row.offsetMeters } : m;
        }),
      );
    },
    [],
  );

  // Узел панели собирается один раз: он уезжает либо в карточку точки, либо под карту —
  // две копии означали бы два запроса об одном и том же маршруте.
  const stopsPanel =
    route && route.mode !== "transit" && route.coordinates.length > 1 && !navActive ? (
        <RouteStopsPanel
          coords={route.coordinates}
          mode={route.mode}
          product={productSlug}
          destId={routePoi?.id ?? null}
          marked={marked.map((m) => m.id)}
          onToggleMark={toggleMark}
          onStops={onStops}
          onOpen={(poi) => {
            changePoiPage(DEFAULT_POI_PAGE);
            setMapExpanded(false);
            setSelected(poi);
            try {
              mapRef.current?.easeTo({ center: [poi.lon, poi.lat] });
            } catch {
              // карта ещё не готова — карточка всё равно открыта
            }
          }}
        />
    ) : null;


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

      // Отмеченная точка по пути: одна фраза на точку за поездку, и только о той,
      // что впереди. Кэшбэк в голос не идёт — за рулём фраза должна быть короткой.
      const cue = stopCue({
        travelled,
        stops: markedRef.current,
        alertMeters: alertMetersRef.current,
        speedMps: u.speedMps,
        log: stopLogRef.current,
      });
      if (cue) {
        const text = t("nav.stopCue", {
          distance: spokenDistance(cue.distanceMeters, t),
          name: cue.name,
          offset: spokenDistance(cue.offsetMeters, t),
        });
        setStopHint(text);
        window.setTimeout(() => setStopHint((prev) => (prev === text ? null : prev)), 20_000);
        speak(text);
      }
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
        {/* Кнопка «моё положение» переехала к масштабу и компасу под картой —
            управление картой живёт в одном месте, а не в двух. */}
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
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

        {/* Перечень найденных адресов: улица с номером, под ней индекс,
            город и область — то, по чему один дом отличается от другого. */}
        {searching && <p className="text-[12px] text-muted">{t("searching")}</p>}
        {searchResults !== null && !searching && (
          <div className="rounded-xl border border-hairline bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
                {searchResults.length > 0
                  ? t("searchFound", { count: searchResults.length })
                  : t("notFound")}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchResults(null);
                  setSearchedAs(null);
                }}
                aria-label={t("searchClose")}
                className="text-[13px] leading-none text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            {searchedAs && (
              <p className="px-3 pt-2 text-[11px] text-muted/80">{t("searchedAs", { query: searchedAs })}</p>
            )}
            <ul className="max-h-72 overflow-y-auto py-1">
              {searchResults.map((hit, i) => (
                <li key={`${hit.lat},${hit.lon},${i}`}>
                  <button
                    type="button"
                    onClick={() => pickSearchResult(hit)}
                    className="flex w-full min-h-[48px] flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-bg-tint"
                  >
                    <span className="text-[13px] font-medium text-foreground">{hit.title ?? hit.label}</span>
                    {hit.subtitle && <span className="text-[11px] text-muted">{hit.subtitle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted/70">{t("clickToDrop")}</p>
      </div>

      {/* Что принимает криптовалюту в этой стране — полосой НАД картой.
          Прежде этот перечень лежал поверх карты и закрывал её собой. */}
      {!mapFull && !navActive && <AvailableNearPanel cc={centerCc} counts={counts} />}

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
            stopsPanel={stopsPanel}
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
                      {navRerouting ? t("rerouting") : (stopHint ?? status ?? navError ?? t("remaining"))}
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
        onLocate={() => geolocateRef.current?.trigger()}
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
            {/* Кружок у фильтра — цвет пульса этого слоя: ровно то, что
                дышит в середине булавки на карте. */}
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: LAYER_COLOR[layer] }}
            />
            {t(`layer_${layer}`)}
            <span className="num text-muted">{counts[layer]}</span>
          </button>
        ))}
        <span className="text-[11px] text-muted flex items-center gap-1.5">
          {/* Толстая каёмка — здесь принимают выбранную монету. Образец
              намеренно серый: речь о толщине кольца, а не о его цвете, иначе
              он читался бы как ещё один источник. */}
          <span
            className="inline-block w-3.5 h-3.5 rounded-full bg-transparent"
            style={{ border: "4px solid #8A8F98" }}
          />
          {t("coinHighlight", { symbol: symbol.toUpperCase() })}
        </span>
        {/* Что значит цвет каёмки — три слова и три кольца. */}
        {(["own", "institution", "osm"] as const).map((brand) => (
          <span key={brand} className="text-[11px] text-muted flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full bg-transparent"
              style={{ border: `2px solid ${BRAND_COLOR[brand]}` }}
            />
            {t(`brand_${brand}`)}
          </span>
        ))}
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

      {/* Места по пути. Карточка точки открыта — панель живёт в ней, рядом с остальным
          управлением маршрутом (правило слайса AI); карточка закрыта — под картой, рядом
          со сводкой. Один узел рисуется в одном месте, поэтому и запрос один. */}
      {!selected && stopsPanel}

      <p className="text-[10px] text-muted/60 leading-relaxed">{t("dataNote")}</p>

      {street && (
        <StreetViewOverlay lat={street.lat} lon={street.lon} name={street.name} onClose={() => setStreet(null)} />
      )}
    </div>
  );
}

/** Отметки этой поездки из хранилища браузера; битая запись — это пусто, а не падение. */
function readMarks(key: string | null): MarkedStop[] {
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    const rows = raw ? (JSON.parse(raw) as MarkedStop[]) : [];
    return Array.isArray(rows)
      ? rows.filter((r) => r && typeof r.id === "string" && Number.isFinite(r.alongMeters))
      : [];
  } catch {
    return [];
  }
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
