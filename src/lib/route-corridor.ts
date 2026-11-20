/**
 * Геометрия коридора маршрута: где по пути стоит место и насколько оно в стороне.
 * Без Prisma и без DOM — это единственная часть подбора остановок, которую можно
 * проверить без карты и без базы, на синтетической линии.
 *
 * Спека: `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`, § 3.
 */
import type { Bbox } from "@/lib/crypto-map";

/** Короче — «по пути» ничего не значит: это пять минут ходьбы. */
export const MIN_ROUTE_METERS = 500;

/**
 * Кусков не больше, чем это: маршрут длиннее — куски просто крупнее. Прямоугольник
 * становится грубее, но точный отбор всё равно идёт в коде, поэтому обрезания нет.
 */
export const MAX_CHUNKS = 48;

/** Сколько остановок показываем. Остаток называется вслух строкой «ещё N по пути». */
export const MAX_STOPS = 40;

const EARTH = 6_371_000;
const RAD = Math.PI / 180;

/** Расстояние между точками по земле (равнопромежуточная проекция — на километрах точна). */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * RAD;
  const dx = (b[0] - a[0]) * RAD * Math.cos(lat);
  const dy = (b[1] - a[1]) * RAD;
  return Math.sqrt(dx * dx + dy * dy) * EARTH;
}

export function routeLength(coords: readonly [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanceMeters(coords[i - 1], coords[i]);
  return total;
}

/**
 * Прореживание линии. Ответ маршрутизатора на триста километров несёт десятки тысяч
 * точек, и считать по ним расстояние до каждой булавки незачем. Концы остаются на
 * месте: начало и конец маршрута — это места, а не округление.
 */
export function sampleLine(
  coords: readonly [number, number][],
  stepMeters: number,
): [number, number][] {
  if (coords.length <= 2) return [...coords];
  const out: [number, number][] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    acc += distanceMeters(coords[i - 1], coords[i]);
    if (acc >= stepMeters) {
      out.push(coords[i]);
      acc = 0;
    }
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/**
 * Прямоугольники кусков маршрута, расширенные на коридор. Один прямоугольник на весь
 * маршрут был бы ловушкой: bbox Праги–Берлина — это триста на триста километров чужих
 * точек, тогда как коридор — полоса шириной три километра.
 */
export function routeChunks(
  coords: readonly [number, number][],
  corridorMeters: number,
  chunkMeters = 25_000,
): Bbox[] {
  if (coords.length === 0) return [];
  const length = routeLength(coords);
  const wanted = Math.max(1, Math.ceil(length / chunkMeters));
  const chunks = Math.min(MAX_CHUNKS, wanted);
  const per = length / chunks;
  const out: Bbox[] = [];
  let current: [number, number][] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += distanceMeters(coords[i - 1], coords[i]);
    current.push(coords[i]);
    if (acc >= per && out.length < chunks - 1) {
      out.push(padBbox(bboxOf(current), corridorMeters));
      // Кусок начинается там, где кончился прежний: щель между прямоугольниками
      // означала бы точку, не попавшую ни в один запрос.
      current = [coords[i]];
      acc = 0;
    }
  }
  if (current.length > 0) out.push(padBbox(bboxOf(current), corridorMeters));
  return out;
}

function bboxOf(coords: readonly [number, number][]): Bbox {
  let minLon = coords[0][0];
  let maxLon = coords[0][0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function padBbox(b: Bbox, meters: number): Bbox {
  const dLat = (meters / EARTH) / RAD;
  const midLat = ((b.minLat + b.maxLat) / 2) * RAD;
  const dLon = dLat / Math.max(0.2, Math.cos(midLat));
  return {
    minLat: b.minLat - dLat,
    maxLat: b.maxLat + dLat,
    minLon: b.minLon - dLon,
    maxLon: b.maxLon + dLon,
  };
}

export type RouteProjection = { alongMeters: number; offsetMeters: number };

/**
 * Где по пути стоит место и насколько в стороне. Считается по прореженной линии: сто
 * метров точности здесь ничего не меняют, а полный ответ маршрутизатора означал бы
 * десятки тысяч сравнений на каждую булавку.
 */
export function projectOnRoute(
  sampled: readonly [number, number][],
  point: { lat: number; lon: number },
): RouteProjection | null {
  if (sampled.length === 0) return null;
  const p: [number, number] = [point.lon, point.lat];
  let along = 0;
  let best: RouteProjection | null = null;
  for (let i = 0; i < sampled.length; i++) {
    if (i > 0) along += distanceMeters(sampled[i - 1], sampled[i]);
    const offset = distanceMeters(sampled[i], p);
    if (!best || offset < best.offsetMeters) best = { alongMeters: along, offsetMeters: offset };
  }
  return best;
}

/**
 * Порядок — по расстоянию вдоль маршрута: это и есть сравнение «через сто километров
 * или через сто пятьдесят», его не нужно изобретать отдельной таблицей. Остаток сверх
 * потолка возвращается числом, а не выбрасывается молча.
 */
export function rankStops<T extends { alongMeters: number }>(
  stops: readonly T[],
): { shown: T[]; hidden: number } {
  const sorted = [...stops].sort((a, b) => a.alongMeters - b.alongMeters);
  return { shown: sorted.slice(0, MAX_STOPS), hidden: Math.max(0, sorted.length - MAX_STOPS) };
}
