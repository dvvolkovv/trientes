import type { RouteMode } from "./crypto-map";

/**
 * Когда считать, что человек сошёл с маршрута и его пора строить заново.
 *
 * Выдержка здесь не украшение: городской GPS выбрасывает одиночные отсчёты за
 * сотню метров, и перестройка на каждом из них превратила бы поездку в
 * непрерывный пересчёт.
 */

export const OFF_ROUTE_M: Record<RouteMode, number> = { walk: 25, car: 40, transit: 120 };

/**
 * В каких режимах сход с линии просит новый маршрут.
 *
 * В транспорте — нет. GPS в тоннеле уходит на сотни метров, и автоматическая
 * перестройка выдала бы человеку, который сидит в едущем вагоне, маршрут с
 * другой пересадкой — вместе с фразой «перестраиваю» каждые пятнадцать секунд.
 * Отход при этом считается по-прежнему: его видно в полосе ведения, а
 * перестройку человек просит кнопкой «Пересчитать».
 */
export const AUTO_REROUTE: Record<RouteMode, boolean> = { walk: true, car: true, transit: false };

/** Сколько отсчётов подряд должны лежать в стороне. */
export const OFF_ROUTE_STREAK = 3;

/** Пауза между перестройками: маршрутизатору нужно время, человеку — тоже. */
export const REROUTE_COOLDOWN_MS = 15_000;

export class OffRouteWatch {
  private readonly threshold: number;
  private readonly autoReroute: boolean;
  private streak = 0;
  // `null`, а не ноль: первая перестройка не должна ждать выдержку от начала
  // эпохи Unix — именно этим ноль и оборачивался.
  private lastRerouteAt: number | null = null;

  constructor(mode: RouteMode) {
    this.threshold = OFF_ROUTE_M[mode] ?? OFF_ROUTE_M.walk;
    this.autoReroute = AUTO_REROUTE[mode] ?? true;
  }

  /** Лежит ли отсчёт в стороне от линии. */
  offRoute(distanceFromRoute: number): boolean {
    return !(distanceFromRoute <= this.threshold);
  }

  /**
   * Отсчёт расстояния до линии → пора ли перестраивать.
   *
   * `moving` обязателен: стоящий человек с маршрута сойти не может, с него
   * сходит его GPS. Городской отсчёт гуляет на сотню метров у окна и в
   * подземном переходе, и без этого условия стоящий получал новый маршрут
   * каждые пятнадцать секунд — вместе с фразой «перестраиваю» и фразой
   * отправления.
   */
  feed(distanceFromRoute: number, nowMs: number, moving: boolean): boolean {
    if (!this.autoReroute) return false;
    if (!moving) {
      this.streak = 0;
      return false;
    }
    if (!this.offRoute(distanceFromRoute)) {
      this.streak = 0;
      return false;
    }
    this.streak += 1;
    if (this.streak < OFF_ROUTE_STREAK) return false;
    if (this.lastRerouteAt !== null && nowMs - this.lastRerouteAt < REROUTE_COOLDOWN_MS) return false;
    this.lastRerouteAt = nowMs;
    this.streak = 0;
    return true;
  }

  /** Маршрут заменён: прежние отсчёты к новой линии не относятся. */
  routeChanged(nowMs: number): void {
    this.streak = 0;
    this.lastRerouteAt = nowMs;
  }
}
