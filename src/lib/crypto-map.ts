// Crypto Navigator data layer — places that transact in crypto, around the viewer.
//
// All sources are free and key-less: BTC Map (an OpenStreetMap derivative, mirrored
// locally — see src/lib/btcmap.ts) for the points, Nominatim for address geocoding,
// OSRM's public demo for routing. Pure parsing
// (parseOverpassElements / parseNominatim / parseOsrm / parseBbox / coinPaymentTags)
// is unit-tested; the fetch* helpers do the network IO and are wrapped so callers
// can degrade to empty results. Mirrors the fear-greed lib's parse/fetch split.

import { lookup } from "node:dns/promises";
import { isWebsiteBlocked } from "@/lib/poi-blocklist";

export { safeHttpUrl } from "./safe-url";

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Parse "minLon,minLat,maxLon,maxLat" (GeoJSON / MapLibre bounds order). */
export function parseBbox(s: string | null): Bbox | null {
  if (!s) return null;
  const parts = s.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  if (maxLon <= minLon || maxLat <= minLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

// OSM payment/currency tags that mark "this coin is accepted here". Bitcoin is by
// far the best-tagged; known altcoins get their specific tag; everything else
// falls back to the generic crypto tag (so the map is still coin-aware where data exists).
const COIN_TAGS: Record<string, string[]> = {
  bitcoin: ["payment:bitcoin", "currency:XBT", "payment:lightning", "payment:lightning_contactless"],
  ethereum: ["payment:ethereum"],
  litecoin: ["payment:litecoin"],
  dogecoin: ["payment:dogecoin"],
  monero: ["payment:monero", "currency:XMR"],
  dash: ["payment:dash"],
  "bitcoin-cash": ["payment:bitcoincash", "currency:BCH"],
  nano: ["payment:nano"],
  zcash: ["payment:zcash"],
};

const SYMBOL_TO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  ltc: "litecoin",
  doge: "dogecoin",
  xmr: "monero",
  dash: "dash",
  bch: "bitcoin-cash",
  xno: "nano",
  zec: "zcash",
};

/** Общий крипто-тег OSM: всё, что мы не знаем по имени, и любой свой листинг. */
export const GENERIC_CRYPTO_TAGS = ["payment:cryptocurrencies"];

/** `SYMBOL_TO_ID` наоборот: id монеты → тикер для чипса. */
const ID_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_TO_ID).map(([symbol, id]) => [id, symbol.toUpperCase()]),
);

/**
 * Какие монеты названы тегами точки. Реестр `COIN_TAGS` читается в обратную
 * сторону: он заведён для вопроса «принимают ли выбранную монету», а здесь
 * отвечает на «какие вообще». Логотипов в тегах OSM нет, и брать их оттуда
 * неоткуда — чипс рисуется тикером.
 */
export function acceptedCoinsFromTags(tags: Record<string, string>): AcceptedCoin[] {
  const out: AcceptedCoin[] = [];
  for (const [id, keys] of Object.entries(COIN_TAGS)) {
    if (!keys.some((k) => tags[k] === "yes")) continue;
    out.push({
      key: id,
      symbol: ID_TO_SYMBOL[id] ?? id.toUpperCase(),
      name: null,
      logoUrl: null,
      slug: id,
      own: false,
    });
  }
  return out;
}

export function coinPaymentTags(coinId: string, symbol: string): string[] {
  const byId = COIN_TAGS[coinId.toLowerCase()];
  if (byId) return byId;
  const id = SYMBOL_TO_ID[symbol.toLowerCase()];
  if (id && COIN_TAGS[id]) return COIN_TAGS[id];
  return [...GENERIC_CRYPTO_TAGS];
}

/**
 * Что выбрано в навигаторе: монета из фида CoinGecko или собственная карточка.
 * Карточки живут в отдельном пространстве id (CoinCard.id — cuid), поэтому в
 * query-параметре они приходят с префиксом `card:`.
 */
export type CoinSelector =
  | { kind: "coin"; coinId: string }
  | { kind: "card"; cardId: string };

const CUID_RE = /^[a-z0-9]{10,40}$/i;

export function parseCoinSelector(raw: string | null | undefined): CoinSelector {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "coin", coinId: "bitcoin" };
  if (s.toLowerCase().startsWith("card:")) {
    const cardId = s.slice("card:".length).trim();
    // Мусорный id не подменяется биткоином: показать «не та монета» хуже, чем
    // показать пусто. Пустой cardId ни с чем не совпадёт в запросе.
    return { kind: "card", cardId: CUID_RE.test(cardId) ? cardId : "" };
  }
  return { kind: "coin", coinId: s.toLowerCase() };
}

/**
 * Точка, ради которой карту открыли.
 *
 * Ссылка «где именно» с карточки монеты прежде вела на `?coin=…` и только:
 * карта открывалась там, где стоит человек, то есть за сотни километров от
 * названного в строке магазина. Название точки обещает место — адрес обязан
 * его нести.
 */
export function parsePointId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  return CUID_RE.test(s) ? s : null;
}

/** Адрес навигатора: монета обязательна, точка — когда зовут в конкретное место. */
export function cryptoMapHref(i: {
  locale: string;
  coin: string;
  pointId?: string | null;
}): string {
  const q = new URLSearchParams({ coin: i.coin });
  if (i.pointId) q.set("point", i.pointId);
  return `/${i.locale}/crypto-map?${q.toString()}`;
}

export type PoiLayer = "merchant" | "atm" | "financial" | "fintech";

export type Social = { network: string; url: string };

/**
 * Монета, которую в этой точке принимают. `own: true` — наш листинг
 * (`CoinCard`), а не монета каталога: это разные пространства id, путать их
 * нельзя, хотя страница у обоих одна — `/coin/<slug>`.
 */
export type AcceptedCoin = {
  key: string;
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  slug: string | null;
  own: boolean;
};

export type Poi = {
  id: string; // "node/123"
  lat: number;
  lon: number;
  name: string;
  layer: PoiLayer;
  category: string;
  address: string | null;
  lightning: boolean;
  coinSpecific: boolean;
  /** Что здесь принимают по именам. Пусто — секции в карточке нет. */
  acceptedCoins: AcceptedCoin[];
  /** Тег `payment:cryptocurrencies`: «какая-то крипта», без тикера. */
  acceptedGeneric: boolean;
  /** Фотографии точки (у своих — до 5); `image` остаётся превью для маркера. */
  photos: string[];
  website: string | null;
  openingHours: string | null;
  phone: string | null;
  email: string | null;
  socials: Social[];
  image: string | null;
  /** Логотип заведения для шапки карточки; у точки зеркала BTC Map его нет. */
  logoUrl: string | null;
  description: string | null;
  /** Жалоб набралось достаточно: точка на карте, но с пометкой «проверяется». */
  underReview?: boolean;
  // Optional in-app deep-link slug. Set only for fintech HQs (→ /{locale}/fintech/{slug}).
  slug?: string;
};

type OsmElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function prettify(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function classify(tags: Record<string, string>): { layer: PoiLayer; category: string } {
  const amenity = tags.amenity;
  if (
    amenity === "atm" ||
    amenity === "bureau_de_change" ||
    amenity === "vending_machine" ||
    tags.vending === "cryptocurrency"
  ) {
    return { layer: "atm", category: tags.vending === "cryptocurrency" ? "Crypto ATM" : prettify(amenity ?? "ATM") };
  }
  if (amenity === "bank" || tags.office === "financial" || tags.office === "bank") {
    return { layer: "financial", category: prettify(amenity ?? tags.office ?? "Financial") };
  }
  const kind = tags.shop ?? tags.amenity ?? tags.tourism ?? tags.office ?? tags.craft ?? tags.leisure;
  return { layer: "merchant", category: kind ? prettify(kind) : "Merchant" };
}

function buildAddress(tags: Record<string, string>): string | null {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Social networks we surface, with the base used to expand a bare handle into a URL.
const SOCIAL_BASES: Record<string, string> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  telegram: "https://t.me/",
  twitter: "https://x.com/",
  x: "https://x.com/",
  youtube: "https://youtube.com/",
  tiktok: "https://tiktok.com/@",
  vk: "https://vk.com/",
  linkedin: "https://linkedin.com/",
};

const isHttp = (s: string) => /^https?:\/\//i.test(s);

/** Map OSM `contact:*` (and bare) tags to {network, url}; bare handles get a base prepended. */
export function parseSocials(tags: Record<string, string>): Social[] {
  const out: Social[] = [];
  for (const network of Object.keys(SOCIAL_BASES)) {
    const raw = (tags[`contact:${network}`] ?? tags[network] ?? "").trim();
    if (!raw) continue;
    const url = isHttp(raw) ? raw : SOCIAL_BASES[network] + raw.replace(/^@/, "");
    out.push({ network, url });
  }
  const wa = (tags["contact:whatsapp"] ?? tags.whatsapp ?? "").trim();
  if (wa) {
    if (isHttp(wa)) out.push({ network: "whatsapp", url: wa });
    else {
      const digits = wa.replace(/\D/g, "");
      if (digits) out.push({ network: "whatsapp", url: "https://wa.me/" + digits });
    }
  }
  return out;
}

/** A displayable photo URL from OSM: a direct `image`, else a Wikimedia Commons thumb. */
export function parseOsmImage(tags: Record<string, string>): string | null {
  const img = (tags.image ?? "").trim();
  if (isHttp(img)) return img;
  const wc = (tags.wikimedia_commons ?? "").trim();
  if (wc.startsWith("File:")) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wc.slice(5))}?width=400`;
  }
  return null;
}

// Still the single decoder for OSM tags: the local BTC Map mirror replays its rows
// through here as `{ elements: [...] }`, so POI shaping lives in exactly one place.
export function parseOverpassElements(raw: unknown, coinTags: string[]): Poi[] {
  const elements = (raw as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Poi[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = el.tags ?? {};
    const website = tags.website || tags["contact:website"] || tags.url || null;
    if (isWebsiteBlocked(website)) continue;
    const { layer, category } = classify(tags);
    const name = tags.name || tags.operator || tags.brand || (layer === "atm" ? "Crypto ATM" : prettify(category));
    const lightning =
      tags["payment:lightning"] === "yes" || tags["payment:lightning_contactless"] === "yes";
    const coinSpecific = coinTags.some((t) => tags[t] === "yes");
    const acceptedCoins = acceptedCoinsFromTags(tags);
    const acceptedGeneric = GENERIC_CRYPTO_TAGS.some((t) => tags[t] === "yes");
    out.push({
      id: `${el.type ?? "node"}/${el.id ?? 0}`,
      lat: lat as number,
      lon: lon as number,
      name,
      layer,
      category,
      address: buildAddress(tags),
      lightning,
      coinSpecific,
      acceptedCoins,
      acceptedGeneric,
      photos: [],
      website,
      openingHours: tags.opening_hours || null,
      phone: tags["contact:phone"] || tags.phone || null,
      email: tags["contact:email"] || tags.email || null,
      socials: parseSocials(tags),
      image: parseOsmImage(tags),
      // У точки зеркала BTC Map логотипа нет и взять его неоткуда: снимок
      // места логотипом не является, подставлять его было бы выдумкой.
      logoUrl: null,
      description: tags.description || null,
    });
  }
  return out;
}

export type GeoResult = {
  label: string;
  lat: number;
  lon: number;
  countryCode?: string;
  /** Первая строка списка: улица с номером дома либо имя места. */
  title?: string;
  /** Вторая строка: индекс, населённый пункт, область, страна. */
  subtitle?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Населённый пункт у Nominatim лежит в разных полях в зависимости от его
 * размера, и у австрийского села это `village`, а не `city`. Перечень
 * городов и сёл с искомой улицей собирается именно из них, поэтому поля
 * перебираются от крупного к мелкому и берётся первое непустое.
 */
function placeName(a: Record<string, unknown>): string {
  return (
    str(a.city) || str(a.town) || str(a.village) || str(a.hamlet) ||
    str(a.municipality) || str(a.suburb) || str(a.county) || ""
  );
}

export function parseNominatim(raw: unknown): GeoResult[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoResult[] = [];
  const seen = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const label = str(r.display_name);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) continue;

    const a = (r.address && typeof r.address === "object" ? r.address : {}) as Record<string, unknown>;
    const road = str(a.road);
    const house = str(a.house_number);
    const postcode = str(a.postcode);
    const place = placeName(a);
    const region = str(a.state) || str(a.province) || "";
    const country = str(a.country);
    const ccRaw = str(a.country_code);
    const countryCode = /^[a-z]{2}$/i.test(ccRaw) ? ccRaw.toUpperCase() : undefined;

    // Подпись собираем из частей адреса, а не из `display_name`: у Австрии
    // тот начинается с кадастровой общины («Katastralgemeinde Ober St. Veit»),
    // и в списке домов это шум, по которому их не отличить друг от друга.
    //
    // Имя объекта идёт раньше улицы: у названного места (остановка, бар)
    // `address.road` — это улица, на которой он стоит, и живой ответ по
    // «Gran Via 8» подписывал остановку чужой улицей Бильбао.
    const named = str(r.name);
    const title = named || (road ? [road, house].filter(Boolean).join(" ") : label.split(",")[0]!.trim());
    const onRoad = named && road && !named.includes(road) ? [road, house].filter(Boolean).join(" ") : "";
    const subtitle = [onRoad, [postcode, place].filter(Boolean).join(" "), region, country]
      .filter(Boolean)
      .join(", ");

    // Одна улица приходит несколькими объектами OSM (дом, точка адреса,
    // отрезок улицы) — в списке это были бы повторы одной строки.
    const key = `${title.toLowerCase()}|${postcode}|${place.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label,
      lat,
      lon,
      ...(countryCode ? { countryCode } : {}),
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
    });
  }
  return out;
}

// Nominatim `reverse` returns a single object (not an array like `search`), or
// `{ error: ... }` when the point can't be resolved.
export function parseReverseGeocode(raw: unknown): GeoResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.error) return null;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const label = String(r.display_name ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) return null;
  // Nominatim with addressdetails=1 returns address.country_code as lower-case ISO-2.
  const address = r.address as Record<string, unknown> | undefined;
  const ccRaw = address && typeof address.country_code === "string" ? address.country_code.trim() : "";
  const countryCode = /^[a-z]{2}$/i.test(ccRaw) ? ccRaw.toUpperCase() : undefined;
  return { label, lat, lon, countryCode };
}

export type RouteMode = "walk" | "car" | "transit";

export type OsrmRoute = {
  distance: number; // meters
  duration: number; // seconds
  geometry: { type: "LineString"; coordinates: [number, number][] };
  steps?: RouteStep[]; // walk/car only, and absent from answers cached before steps existed
};

// One OSRM maneuver: what to do at the start of the step, and how far the step runs.
export type RouteStep = {
  type: string; // "turn" | "depart" | "arrive" | "roundabout" | …
  modifier: string | null; // "left" | "slight right" | "uturn" | …
  name: string | null; // street the step runs along
  distance: number; // meters
  exit: number | null; // roundabout exit number
  location: [number, number]; // [lon,lat] of the maneuver
};

// Остановка на пути ноги: промежуточная или конечная.
export type TransitStop = {
  name: string;
  lat: number;
  lon: number;
  /** Время прибытия (ISO); `null` — маршрутизатор его не назвал. */
  arrival: string | null;
};

/**
 * Шаг пешей ноги — ровно настолько, насколько о нём сказал маршрутизатор.
 *
 * Поворотов MOTIS в живом прогоне не знает (29 шагов на 318 м, все `CONTINUE`,
 * улицы пустые), зато знает смену уровня — выход из вестибюля метро по
 * лестнице. Поэтому поворот произносится только когда он действительно назван,
 * а не достраивается нами из геометрии.
 */
export type TransitWalkStep = {
  direction: string; // "CONTINUE" | "LEFT" | "STAIRS" | "ELEVATOR" | …
  streetName: string | null;
  distance: number; // meters
  /** Смена уровня: вверх, вниз или без смены. */
  level: "up" | "down" | null;
};

// A single leg of a public-transport itinerary — a walking connector or a vehicle ride.
export type TransitLeg = {
  mode: string; // "WALK" | "SUBWAY" | "BUS" | "TRAM" | "RAIL" | …
  line: string | null; // route short name, e.g. "U4"
  from: string | null; // boarding stop
  to: string | null; // alighting stop
  duration: number; // seconds
  dashed: boolean; // render dashed (walking connector)
  color: string; // line colour on the map
  coordinates: [number, number][]; // [lon,lat]
  /**
   * Длина ГЕОМЕТРИИ ноги в метрах. Своё число `distance` в ответе есть, но по
   * геометрии считается продвижение по маршруту, и второе число разошлось бы с
   * первым на глазах у человека.
   */
  meters: number;
  /** В какую сторону идёт рейс — то, что написано на лбу автобуса. */
  headsign: string | null;
  agency: string | null;
  fromPoint: [number, number] | null; // [lon,lat] остановки посадки
  toPoint: [number, number] | null; // [lon,lat] остановки выхода
  fromTrack: string | null; // платформа посадки
  toTrack: string | null;
  startTime: string | null; // ISO
  endTime: string | null; // ISO
  /** Время наблюдаемое, а не обещанное таблицей. */
  realTime: boolean;
  /** Промежуточные остановки — из них считается, сколько остановок ехать. */
  stops: TransitStop[];
  /** Шаги пешей ноги, если маршрутизатор их назвал. */
  walkSteps: TransitWalkStep[];
};

export type RouteResult = OsrmRoute & {
  mode: RouteMode;
  transfers?: number; // transit only
  legs?: TransitLeg[]; // transit only
  /** Расписание поездки (ISO) — в транспорте остаток времени берётся отсюда. */
  startTime?: string | null;
  endTime?: string | null;
};

type RawStep = {
  distance?: unknown;
  name?: unknown;
  maneuver?: { type?: unknown; modifier?: unknown; exit?: unknown; location?: unknown };
};

function parseStep(raw: RawStep): RouteStep | null {
  const m = raw.maneuver;
  const type = typeof m?.type === "string" ? m.type : null;
  const loc = m?.location;
  const distance = Number(raw.distance);
  if (!type || !Number.isFinite(distance)) return null;
  const location: [number, number] =
    Array.isArray(loc) && loc.length >= 2 && Number.isFinite(Number(loc[0])) && Number.isFinite(Number(loc[1]))
      ? [Number(loc[0]), Number(loc[1])]
      : [0, 0];
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : null;
  const exit = Number.isFinite(Number(m?.exit)) ? Number(m?.exit) : null;
  return {
    type,
    modifier: typeof m?.modifier === "string" ? m.modifier : null,
    name,
    distance,
    exit,
    location,
  };
}

export function parseOsrm(raw: unknown): OsrmRoute | null {
  const r = raw as { code?: string; routes?: Array<Record<string, unknown>> } | null;
  if (!r || r.code !== "Ok" || !Array.isArray(r.routes) || r.routes.length === 0) return null;
  const route = r.routes[0];
  const distance = Number(route.distance);
  const duration = Number(route.duration);
  const geometry = route.geometry as OsrmRoute["geometry"] | undefined;
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || !geometry?.coordinates) return null;
  const legs = Array.isArray(route.legs) ? (route.legs as Array<{ steps?: unknown }>) : [];
  const steps = legs
    .flatMap((leg) => (Array.isArray(leg?.steps) ? (leg.steps as RawStep[]) : []))
    .map(parseStep)
    .filter((s): s is RouteStep => s !== null);
  // Absent, not empty: an answer without maneuvers must stay indistinguishable
  // from one the renderer never asked for.
  return steps.length > 0 ? { distance, duration, geometry, steps } : { distance, duration, geometry };
}

// ---- Public-transport routing (MOTIS / Transitous) ----

// Google "encoded polyline" → [lon,lat] pairs (GeoJSON order). MOTIS emits precision 7.
export function decodePolyline(str: string, precision = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

// Map a MOTIS leg mode to a line colour: rail/metro blue, bus green, tram orange.
const TRANSIT_COLORS: Record<string, string> = {
  WALK: "#8a8f98",
  SUBWAY: "#5B8DEF",
  METRO: "#5B8DEF",
  RAIL: "#5B8DEF",
  REGIONAL_RAIL: "#5B8DEF",
  REGIONAL_FAST_RAIL: "#5B8DEF",
  LONG_DISTANCE: "#5B8DEF",
  HIGHSPEED_RAIL: "#5B8DEF",
  NIGHT_RAIL: "#5B8DEF",
  BUS: "#30B658",
  COACH: "#30B658",
  TRAM: "#FE5C04",
  FERRY: "#19C2C2",
};

function transitColor(mode: string): string {
  return TRANSIT_COLORS[mode.toUpperCase()] ?? "#FE5C04";
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function legLengthMeters(c: [number, number][]): number {
  const R = 6371000;
  let total = 0;
  for (let i = 1; i < c.length; i++) {
    const dLat = ((c[i][1] - c[i - 1][1]) * Math.PI) / 180;
    const dLon = ((c[i][0] - c[i - 1][0]) * Math.PI) / 180;
    const la1 = (c[i - 1][1] * Math.PI) / 180;
    const la2 = (c[i][1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return total;
}

type MotisPlace = {
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  track?: unknown;
  scheduledTrack?: unknown;
  arrival?: unknown;
  departure?: unknown;
};
type MotisStepInstruction = {
  relativeDirection?: unknown;
  streetName?: unknown;
  distance?: unknown;
  fromLevel?: unknown;
  toLevel?: unknown;
};
type MotisLeg = {
  mode?: string;
  duration?: number;
  routeShortName?: string;
  headsign?: unknown;
  agencyName?: unknown;
  realTime?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  scheduledStartTime?: unknown;
  scheduledEndTime?: unknown;
  from?: MotisPlace;
  to?: MotisPlace;
  intermediateStops?: unknown;
  steps?: unknown;
  legGeometry?: { points?: string; precision?: number };
};
type MotisItinerary = {
  duration?: number;
  transfers?: number;
  startTime?: unknown;
  endTime?: unknown;
  legs?: MotisLeg[];
};

/** Непустая строка или `null` — у MOTIS пустая строка значит «не сказано». */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Координата — только настоящее число.
 *
 * `Number(null)` — это ноль, и без строгой проверки остановка без координат
 * уезжала на Null Island, то есть в Гвинейский залив. Тем же нулём она
 * оказалась бы на линии в самом её начале, и «сколько остановок осталось»
 * считалось бы не по тем остановкам.
 */
function coord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function point(latRaw: unknown, lonRaw: unknown): [number, number] | null {
  const lat = coord(latRaw);
  const lon = coord(lonRaw);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null; // Null Island — не место
  return [lon, lat];
}

function place(p: MotisPlace | undefined): {
  name: string | null;
  point: [number, number] | null;
  track: string | null;
} {
  // «START» и «END» — это наши же концы маршрута, а не названия мест.
  const raw = text(p?.name);
  const name = raw === "START" || raw === "END" ? null : raw;
  return {
    name,
    point: point(p?.lat, p?.lon),
    track: text(p?.track) ?? text(p?.scheduledTrack),
  };
}

function parseStops(raw: unknown): TransitStop[] {
  if (!Array.isArray(raw)) return [];
  const out: TransitStop[] = [];
  for (const item of raw as MotisPlace[]) {
    const name = text(item?.name);
    const at = point(item?.lat, item?.lon);
    if (!name || !at) continue;
    out.push({ name, lat: at[1], lon: at[0], arrival: text(item?.arrival) ?? text(item?.departure) });
  }
  return out;
}

/** Шаг короче этого ничего не говорит пешеходу — его метры уходят соседу. */
const WALK_STEP_MIN_M = 20;
/** Сколько шагов пешей ноги вообще имеет смысл везти. */
const WALK_STEP_MAX = 30;

/**
 * Шаги пешей ноги: сначала склейка, потом отсев мелочи.
 *
 * Живой ответ отдаёт двадцать девять шагов на триста метров, из них половина
 * короче трёх метров. Склеиваются идущие подряд «прямо» по той же улице, а
 * смена уровня не склеивается никогда: лестница — единственное, что в этих
 * данных сказано твёрдо.
 */
export function parseWalkSteps(raw: unknown): TransitWalkStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: TransitWalkStep[] = [];
  for (const item of raw as MotisStepInstruction[]) {
    const distance = Number(item?.distance);
    if (!Number.isFinite(distance) || distance < 0) continue;
    const from = Number(item?.fromLevel);
    const to = Number(item?.toLevel);
    const level =
      Number.isFinite(from) && Number.isFinite(to) && to !== from
        ? to > from
          ? "up"
          : "down"
        : null;
    steps.push({
      direction: (text(item?.relativeDirection) ?? "CONTINUE").toUpperCase(),
      streetName: text(item?.streetName),
      distance,
      level,
    });
  }

  const merged: TransitWalkStep[] = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    const sameWay = !s.streetName || s.streetName === prev?.streetName;
    if (prev && !prev.level && !s.level && s.direction === "CONTINUE" && sameWay) {
      prev.distance += s.distance;
      continue;
    }
    merged.push({ ...s });
  }

  const out: TransitWalkStep[] = [];
  for (const s of merged) {
    if (!s.level && s.distance < WALK_STEP_MIN_M && out.length) {
      out[out.length - 1].distance += s.distance;
      continue;
    }
    out.push(s);
  }
  return out.slice(0, WALK_STEP_MAX);
}

/** Take the first MOTIS itinerary; decode + stitch its legs into one route. */
export function parseMotis(raw: unknown): RouteResult | null {
  const its = (raw as { itineraries?: MotisItinerary[] } | null)?.itineraries;
  if (!Array.isArray(its) || its.length === 0) return null;
  const it = its[0];
  const rawLegs = Array.isArray(it.legs) ? it.legs : [];
  const legs: TransitLeg[] = [];
  const coords: [number, number][] = [];
  let distance = 0;
  for (const lg of rawLegs) {
    const mode = String(lg.mode ?? "WALK").toUpperCase();
    const pts = lg.legGeometry?.points;
    const c = typeof pts === "string" && pts ? decodePolyline(pts, lg.legGeometry?.precision ?? 7) : [];
    if (c.length === 0) continue;
    for (let i = 0; i < c.length; i++) {
      if (i === 0 && coords.length && samePoint(coords[coords.length - 1], c[0])) continue;
      coords.push(c[i]);
    }
    const meters = legLengthMeters(c);
    distance += meters;
    const from = place(lg.from);
    const to = place(lg.to);
    legs.push({
      mode,
      line: lg.routeShortName ? String(lg.routeShortName) : null,
      from: from.name,
      to: to.name,
      duration: Number(lg.duration) || 0,
      dashed: mode === "WALK",
      color: transitColor(mode),
      coordinates: c,
      meters: Math.round(meters),
      headsign: text(lg.headsign),
      agency: text(lg.agencyName),
      fromPoint: from.point,
      toPoint: to.point,
      fromTrack: from.track,
      toTrack: to.track,
      startTime: text(lg.startTime) ?? text(lg.scheduledStartTime),
      endTime: text(lg.endTime) ?? text(lg.scheduledEndTime),
      realTime: lg.realTime === true,
      stops: mode === "WALK" ? [] : parseStops(lg.intermediateStops),
      walkSteps: mode === "WALK" ? parseWalkSteps(lg.steps) : [],
    });
  }
  if (coords.length < 2 || legs.length === 0) return null;
  const duration = Number(it.duration);
  const transfers = Number(it.transfers);
  return {
    mode: "transit",
    distance: Math.round(distance),
    duration: Number.isFinite(duration) ? duration : legs.reduce((s, l) => s + l.duration, 0),
    geometry: { type: "LineString", coordinates: coords },
    transfers: Number.isFinite(transfers) ? transfers : 0,
    legs,
    startTime: text(it.startTime),
    endTime: text(it.endTime),
  };
}

// ---- OpenGraph preview (lazy, per-POI website) ----

export type OgPreview = { title: string | null; image: string | null; video: string | null };

// Decode the handful of HTML entities that actually show up in meta content —
// crucially `&amp;`, which CDNs emit inside og:image query strings. `&amp;` is
// resolved last so `&amp;amp;` collapses to `&amp;` rather than `&`.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Read one attribute off a single `<meta …>` string. The name must be preceded by
// whitespace (or tag start) so `content` doesn't match inside `data-content`.
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities((m[2] ?? m[3] ?? "").trim()) : null;
}

function metaContent(html: string, keys: string[]): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (key && keys.includes(key)) {
      const content = attr(m[0], "content");
      if (content) return content;
    }
  }
  return null;
}

function absHttp(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Extract og:image/og:video/og:title (twitter:image fallback); resolve & http(s)-filter URLs. */
export function parseOpenGraph(html: string, baseUrl: string): OgPreview {
  return {
    title: metaContent(html, ["og:title"]) ?? null,
    image: absHttp(metaContent(html, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image"]), baseUrl),
    video: absHttp(metaContent(html, ["og:video", "og:video:url", "og:video:secure_url"]), baseUrl),
  };
}

// ---- SSRF guard ----

/** True for loopback / private / link-local / unspecified IPv4 & IPv6 (incl. IPv4-mapped). */
export function isBlockedIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  const m4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const a = Number(m4[1]);
    const b = Number(m4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (v === "::" || v === "::1") return true;
  if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(v)) return true; // unique-local fc00::/7
  const mapped = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIp(mapped[1]);
  return false;
}

/** Validate scheme/credentials and reject literal-IP/localhost hosts. Does NOT resolve DNS. */
export function assertUrlShape(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme not allowed");
  if (u.username || u.password) throw new Error("credentials not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("localhost not allowed");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    if (isBlockedIp(host)) throw new Error("blocked ip literal");
  }
  return u;
}

// ---- Network helpers (wrapped; callers degrade to empty/null on failure) ----

const UA = "trientes.org crypto-navigator (https://trientes.org)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
// FOSSGIS OSRM instances are key-less and expose the foot profile (the demo server
// only has driving); MOTIS/Transitous adds key-less timetable-based transit routing.
const OSRM_FOOT_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const OSRM_CAR_URL = "https://routing.openstreetmap.de/routed-car/route/v1/driving";
const MOTIS_URL = "https://api.transitous.org/api/v1/plan";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Поиск адреса.
 *
 * `countryCode` — страна, в которой человек сейчас смотрит карту, и это
 * главный рычаг: без него Nominatim ранжирует по мировой важности, и живой
 * запрос «Hauptstrasse 8» отдавал три адреса в Германии, не показав Австрию
 * вовсе; с `countrycodes=at` — двенадцать австрийских адресов с индексами,
 * то есть ровно перечень городов и сёл с этой улицей.
 *
 * `viewbox` сознательно не посылается: рамка вокруг карты не поднимает
 * ближние адреса, а отрезает дальние (с ней те же двенадцать превращаются в
 * три), то есть убивает перечень по стране.
 */
export async function fetchGeocode(
  q: string,
  opts: { countryCode?: string | null; lang?: string | null; limit?: number; timeoutMs?: number } = {},
): Promise<GeoResult[]> {
  const { countryCode, lang, limit = 20, timeoutMs = 8000 } = opts;
  return withTimeout(timeoutMs, async (signal) => {
    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      limit: String(limit),
      q,
    });
    if (countryCode && /^[a-z]{2}$/i.test(countryCode)) {
      params.set("countrycodes", countryCode.toLowerCase());
    }
    if (lang && /^[a-z-]{2,8}$/i.test(lang)) params.set("accept-language", lang);
    const url = `${NOMINATIM_URL}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
    return parseNominatim(await res.json());
  });
}

// Resolve a dropped/dragged pin (lon,lat) to a human address, best-effort.
export async function fetchReverseGeocode(
  lon: number,
  lat: number,
  timeoutMs = 8000,
): Promise<GeoResult | null> {
  return withTimeout(timeoutMs, async (signal) => {
    const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`nominatim reverse HTTP ${res.status}`);
    return parseReverseGeocode(await res.json());
  });
}

export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  mode: RouteMode = "car",
  timeoutMs = 9000,
): Promise<RouteResult | null> {
  return withTimeout(timeoutMs, async (signal) => {
    if (mode === "transit") {
      // MOTIS takes lat,lon (OSRM/our tuples are lon,lat).
      const url =
        `${MOTIS_URL}?fromPlace=${from[1]},${from[0]}&toPlace=${to[1]},${to[0]}` +
        `&transitModes=TRANSIT&directModes=WALK`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`motis HTTP ${res.status}`);
      return parseMotis(await res.json());
    }
    const base = mode === "walk" ? OSRM_FOOT_URL : OSRM_CAR_URL;
    const url = `${base}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`osrm HTTP ${res.status}`);
    const r = parseOsrm(await res.json());
    return r ? { ...r, mode } : null;
  });
}

// ---- OpenGraph fetch (SSRF-guarded; degrades to an empty preview) ----

const EMPTY_OG: OgPreview = { title: null, image: null, video: null };
const OG_MAX_BYTES = 256 * 1024;

// `dns.lookup` ignores AbortSignal, so the outer fetch timeout can't bound it —
// race it against its own timeout to avoid a hung resolver stalling the request.
async function lookupAll(host: string, ms = 4000): Promise<Array<{ address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("dns timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** assertUrlShape + DNS resolution, rejecting hosts that resolve to a blocked IP. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = assertUrlShape(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return u; // already vetted as a literal
  const records = await lookupAll(host);
  if (records.some((r) => isBlockedIp(r.address))) throw new Error("resolves to blocked ip");
  return u;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks));
}

/** Fetch a place's website and return its OpenGraph preview. Best-effort; never throws. */
export async function fetchOgPreview(rawUrl: string, timeoutMs = 6000): Promise<OgPreview> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      let current = await assertPublicUrl(rawUrl);
      let res: Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        res = await fetch(current.href, {
          headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
          redirect: "manual",
          cache: "no-store",
          signal,
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          current = await assertPublicUrl(new URL(loc, current).href); // re-vet every hop
          continue;
        }
        break;
      }
      if (!res || !res.ok) return EMPTY_OG;
      if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("html")) return EMPTY_OG;
      return parseOpenGraph(await readCapped(res, OG_MAX_BYTES), current.href);
    });
  } catch {
    return EMPTY_OG;
  }
}
