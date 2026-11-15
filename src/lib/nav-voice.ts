import type { RouteMode, RouteStep } from "./crypto-map";
import { activeStep, announcementBand, type AnnouncementBand } from "./route-steps";

/**
 * Что голос должен сказать в этот момент движения — и ничего больше.
 *
 * Отдельно от компонента, потому что это единственная часть ведения, которую
 * можно проверить без телефона и без карты: на синтетическом маршруте видно,
 * что полоса произносится один раз, что возврат GPS назад не переигрывает
 * сказанное и что пересчёт начинает счёт заново.
 */

/**
 * Что уже произнесено. Шаг хранится номером и только растёт: GPS дёргается
 * назад на пару метров постоянно, и без этого «через 300 метров направо»
 * звучало бы дважды.
 */
export class VoiceLog {
  private step = -1;
  private bands = new Set<AnnouncementBand>();

  /** Можно ли произнести эту полосу этого шага; «да» помечает её сказанной. */
  claim(stepIndex: number, band: AnnouncementBand): boolean {
    if (stepIndex < this.step) return false;
    if (stepIndex > this.step) {
      this.step = stepIndex;
      this.bands = new Set();
    }
    if (this.bands.has(band)) return false;
    this.bands.add(band);
    return true;
  }

  /** Новый маршрут — новые манёвры: прежде сказанное к ним не относится. */
  reset(): void {
    this.step = -1;
    this.bands = new Set();
  }
}

export type Announcement = {
  band: AnnouncementBand;
  /** Номер шага, который человек проезжает. Манёвр закрывает этот шаг. */
  stepIndex: number;
  step: RouteStep;
  distanceMeters: number;
};

export function nextAnnouncement(i: {
  travelled: number;
  ends: readonly number[];
  steps: readonly RouteStep[];
  mode: RouteMode;
  speedMps: number;
  log: VoiceLog;
}): Announcement | null {
  const current = activeStep(i.travelled, i.ends);
  if (!current) return null;
  // OSRM ставит манёвр в НАЧАЛО шага, поэтому тот, который человек вот-вот
  // выполнит, закрывает проезжаемый шаг и описан следующим.
  const next = i.steps[current.index + 1];
  if (!next) return null;
  const band = announcementBand(current.distanceToManeuver, i.mode, i.speedMps);
  if (!band) return null;
  if (!i.log.claim(current.index, band)) return null;
  return { band, stepIndex: current.index, step: next, distanceMeters: current.distanceToManeuver };
}

/**
 * Фраза отправления: первый манёвр и расстояние до него. Произносится при
 * нажатии «Поехали» — это и есть жест, которым открывается синтез речи, и
 * заодно ответ на «почему он молчит первые полкилометра».
 */
export function departureAnnouncement(
  steps: readonly RouteStep[],
  log: VoiceLog,
): { step: RouteStep; distanceMeters: number } | null {
  if (steps.length < 2) return null;
  // «Продолжайте движение километр» секундой позже сказало бы ровно то же
  // самое другими словами — полоса этого перегона считается закрытой.
  log.claim(0, "continue");
  return { step: steps[1], distanceMeters: Math.max(0, steps[0].distance) };
}
