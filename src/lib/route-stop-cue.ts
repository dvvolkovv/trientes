/**
 * Что голос должен сказать об отмеченной точке в этот момент движения — и ничего
 * больше. Отдельно от компонента по той же причине, что `nav-voice.ts`: на
 * синтетическом отсчёте видно, что фраза звучит один раз, что возврат GPS назад её не
 * переигрывает и что о проеханной точке никто не вспоминает.
 *
 * Спека: `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`, § 4.
 */

export type MarkedStop = {
  id: string;
  name: string;
  alongMeters: number;
  offsetMeters: number;
};

export type StopCue = {
  id: string;
  name: string;
  /** Сколько осталось до точки по маршруту. */
  distanceMeters: number;
  offsetMeters: number;
};

/**
 * Об одной точке — одна фраза за поездку. Пересчёт маршрута счёт не обнуляет: место от
 * пересчёта не изменилось, а повторное «через полтора километра заправка» звучало бы
 * каждый раз, когда GPS сорвал линию.
 */
export class StopVoiceLog {
  private said = new Set<string>();

  claim(id: string): boolean {
    if (this.said.has(id)) return false;
    this.said.add(id);
    return true;
  }
}

/**
 * Порог — максимум из настройки человека и «минуты хода»: на 110 км/ч полтора километра
 * это 49 секунд, и за рулём фраза должна прозвучать до поворота, а не на нём.
 */
export function stopCue(i: {
  travelled: number;
  stops: readonly MarkedStop[];
  alertMeters: number;
  speedMps: number;
  log: StopVoiceLog;
}): StopCue | null {
  const threshold = Math.max(i.alertMeters, Math.max(0, i.speedMps) * 60);
  let best: MarkedStop | null = null;
  for (const stop of i.stops) {
    const left = stop.alongMeters - i.travelled;
    // Позади — молча: догонять поздно, а «вы проехали заправку» человеку за рулём
    // сообщать незачем.
    if (left <= 0 || left > threshold) continue;
    if (!best || stop.alongMeters < best.alongMeters) best = stop;
  }
  if (!best) return null;
  if (!i.log.claim(best.id)) return null;
  return {
    id: best.id,
    name: best.name,
    distanceMeters: Math.round(best.alongMeters - i.travelled),
    offsetMeters: best.offsetMeters,
  };
}
