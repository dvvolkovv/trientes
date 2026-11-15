import type { TransitLeg } from "./crypto-map";
import { VoiceLog } from "./nav-voice";
import { announcementBand, type AnnouncementBand } from "./route-steps";
import { haversineMeters, nearestOnLineString } from "./route-geometry";

/**
 * Что сказать человеку, который едет общественным транспортом, — и ничего
 * больше.
 *
 * У составного маршрута нет манёвров: MOTIS отдаёт ноги, а не повороты
 * (живой прогон: двадцать девять шагов `CONTINUE` на триста метров, улицы
 * пустые). Зато он отдаёт то, что пассажиру и нужно, — имя остановки,
 * платформу, сторону рейса и промежуточные остановки. Поэтому подсказка здесь
 * считается **по ногам и по остановкам**, а не по метрам до поворота: «через
 * четыреста метров выходите» в метро не значит ничего, а «следующая остановка
 * ваша» значит всё.
 *
 * Модуль чистый: ни карты, ни DOM, ни перевода. Слова подбирает разметка.
 */

/** Границы ноги по длине сшитой линии маршрута. */
export type LegSpan = { start: number; end: number };

/**
 * Разложить ноги по сшитой линии.
 *
 * Меряется по ГЕОМЕТРИИ ног, а не по их полю `meters`: продвижение приходит из
 * `remainingMeters()` по той же линии, и округлённое число разошлось бы с ней.
 * Разрыв между ногами (концы не совпали) принадлежит линии и потому входит в
 * отсчёт — иначе подсказка уезжала бы вперёд на каждой пересадке.
 */
export function legSpans(legs: readonly TransitLeg[]): LegSpan[] {
  const spans: LegSpan[] = [];
  let cursor = 0;
  let previousEnd: [number, number] | null = null;
  for (const leg of legs) {
    const c = leg.coordinates;
    if (c.length === 0) {
      spans.push({ start: cursor, end: cursor });
      continue;
    }
    if (previousEnd) cursor += haversineMeters(previousEnd, c[0]);
    const start = cursor;
    for (let i = 1; i < c.length; i++) cursor += haversineMeters(c[i - 1], c[i]);
    previousEnd = c[c.length - 1];
    spans.push({ start, end: cursor });
  }
  return spans;
}

export type ActiveLeg = { index: number; metersIntoLeg: number; metersToEnd: number };

/** Какая нога идёт сейчас и сколько осталось до её конца. */
export function activeLeg(travelled: number, spans: readonly LegSpan[]): ActiveLeg | null {
  if (spans.length === 0) return null;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].end > travelled) {
      return {
        index: i,
        metersIntoLeg: Math.max(0, travelled - spans[i].start),
        metersToEnd: spans[i].end - travelled,
      };
    }
  }
  const last = spans.length - 1;
  return {
    index: last,
    metersIntoLeg: Math.max(0, spans[last].end - spans[last].start),
    metersToEnd: 0,
  };
}

/**
 * Промежуточные остановки в метрах от начала ноги.
 *
 * Остановка приходит координатами, а не расстоянием, поэтому она ставится на
 * линию проекцией — тем же приёмом, которым ведение ставит на линию человека.
 */
export function stopOffsets(leg: TransitLeg): number[] {
  const c = leg.coordinates;
  if (leg.stops.length === 0 || c.length < 2) return [];
  return leg.stops.map((s) => {
    const projection = nearestOnLineString([s.lon, s.lat], c);
    let along = 0;
    for (let i = 1; i <= projection.segmentIndex; i++) along += haversineMeters(c[i - 1], c[i]);
    const segment = haversineMeters(c[projection.segmentIndex], c[projection.segmentIndex + 1] ?? c[projection.segmentIndex]);
    return along + segment * projection.t;
  });
}

/** Чем занят человек прямо сейчас. */
export type TransitCueKind = "walk" | "board" | "ride" | "alightNext" | "alight";

export type TransitCue = {
  kind: TransitCueKind;
  legIndex: number;
  leg: TransitLeg;
  /** Нога, в которую человек сядет; `null` — садиться больше некуда. */
  nextLeg: TransitLeg | null;
  /** Остановка, о которой идёт речь; `null` у последней пешей ноги — там цель. */
  stopName: string | null;
  /** До конца текущей ноги. */
  distanceMeters: number;
  /** Остановок до выхода, включая свою; `null` — человек не в транспорте. */
  stopsLeft: number | null;
  /** Пешая нога между двумя рейсами — это пересадка, а не подход. */
  transfer: boolean;
};

/** «Дошёл»: та же полоса, на которой пеший режим произносит сам манёвр. */
const BOARD_M = 15;
/** «Выходите»: двери ещё не открылись, но вставать пора. */
const ALIGHT_M = 60;

export function transitCue(i: {
  travelled: number;
  legs: readonly TransitLeg[];
  spans: readonly LegSpan[];
}): TransitCue | null {
  const active = activeLeg(i.travelled, i.spans);
  if (!active) return null;
  const leg = i.legs[active.index];
  if (!leg) return null;
  const nextLeg = i.legs[active.index + 1] ?? null;
  const previousLeg = i.legs[active.index - 1] ?? null;
  const base = {
    legIndex: active.index,
    leg,
    nextLeg,
    distanceMeters: active.metersToEnd,
    transfer: leg.dashed && !!previousLeg && !previousLeg.dashed && !!nextLeg && !nextLeg.dashed,
  };

  if (leg.dashed) {
    const boarding = nextLeg && !nextLeg.dashed;
    return {
      ...base,
      kind: boarding && active.metersToEnd <= BOARD_M ? "board" : "walk",
      stopName: (boarding ? nextLeg.from : null) ?? leg.to ?? null,
      stopsLeft: null,
    };
  }

  const passed = stopOffsets(leg).filter((o) => o > active.metersIntoLeg).length;
  const stopsLeft = passed + 1; // своя остановка тоже впереди, пока не вышел
  const kind: TransitCueKind =
    active.metersToEnd <= ALIGHT_M ? "alight" : stopsLeft <= 1 ? "alightNext" : "ride";
  return { ...base, kind, stopName: leg.to ?? nextLeg?.from ?? null, stopsLeft };
}

export type TransitAnnouncement = { cue: TransitCue; band: AnnouncementBand };

/**
 * Полоса объявления для подсказки.
 *
 * У пешей ноги она метровая — те же пороги, что у пешего режима. У рейса
 * метров нет: полосу задаёт сама подсказка, потому что «осталась одна
 * остановка» — это и есть расстояние, которое пассажир понимает.
 */
function bandFor(cue: TransitCue, speedMps: number): AnnouncementBand | null {
  switch (cue.kind) {
    case "board":
      return "now";
    case "ride":
      return "continue";
    case "alightNext":
      return "near";
    case "alight":
      return "now";
    default: {
      const band = announcementBand(cue.distanceMeters, "walk", speedMps);
      // Последняя нога вплотную к цели молчит: ведение само говорит «вы
      // приехали» за двадцать пять метров, и вторая фраза поверх неё была бы
      // той же мыслью другими словами.
      if (!cue.nextLeg && (band === "near" || band === "now")) return null;
      return band;
    }
  }
}

/**
 * Что произнести на этом отсчёте, или `null`, если сказать нечего.
 *
 * Сказанное помнит тот же `VoiceLog`, что и манёвры: номер ноги вместо номера
 * шага. Он монотонный, поэтому дёрнувшийся назад GPS не переигрывает
 * сказанное — а в транспорте он дёргается особенно охотно.
 */
export function nextTransitCue(i: {
  travelled: number;
  legs: readonly TransitLeg[];
  spans: readonly LegSpan[];
  speedMps: number;
  log: VoiceLog;
}): TransitAnnouncement | null {
  const cue = transitCue({ travelled: i.travelled, legs: i.legs, spans: i.spans });
  if (!cue) return null;
  const band = bandFor(cue, i.speedMps);
  if (!band) return null;
  if (!i.log.claim(cue.legIndex, band)) return null;
  return { cue, band };
}

/**
 * Фраза отправления: куда идти с места, какой бы длинной ни была первая нога.
 *
 * Произносится при нажатии «Поехали» — это тот самый жест, которым браузеру
 * разрешают говорить, и заодно ответ на «почему он молчит первый километр».
 */
export function departureCue(
  legs: readonly TransitLeg[],
  spans: readonly LegSpan[],
  log: VoiceLog,
): TransitCue | null {
  const cue = transitCue({ travelled: 0, legs, spans });
  if (!cue) return null;
  log.claim(cue.legIndex, "continue");
  return cue;
}

/**
 * Одна и та же фраза подряд не произносится дважды.
 *
 * Полосы объявлений считаются по расстоянию, а текст подсказки у пешей ноги —
 * это то же расстояние словами. На короткой ноге (живой прогон: шестнадцать
 * метров от выхода из вестибюля до входа в метро) две соседние полосы дают
 * одну и ту же фразу, и человек слышит «идите двадцать метров до
 * Staroměstská» дважды за две секунды. Помнится ровно последняя сказанная:
 * повтор через другую фразу — это уже новая мысль, и глушить его незачем.
 */
export class SpokenPhrases {
  private last: string | null = null;

  /** Можно ли это произнести; «да» помечает фразу последней сказанной. */
  claim(text: string): boolean {
    if (text === this.last) return false;
    this.last = text;
    return true;
  }

  reset(): void {
    this.last = null;
  }
}

const VEHICLE: Record<string, string> = {
  WALK: "walk",
  SUBWAY: "metro",
  METRO: "metro",
  RAIL: "rail",
  REGIONAL_RAIL: "rail",
  REGIONAL_FAST_RAIL: "rail",
  LONG_DISTANCE: "rail",
  HIGHSPEED_RAIL: "rail",
  NIGHT_RAIL: "rail",
  BUS: "bus",
  COACH: "bus",
  TRAM: "tram",
  FERRY: "ferry",
};

/**
 * Как пассажир назовёт этот транспорт (`cryptoMap.nav.transit.vehicle_<key>`).
 * Незнакомый вид — «транспорт»: сказать общее лучше, чем сказать `CABLE_CAR`.
 */
export function vehicleKey(mode: string): string {
  return VEHICLE[mode.toUpperCase()] ?? "transit";
}
