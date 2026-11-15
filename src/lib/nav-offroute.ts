import type { RouteMode } from "./crypto-map";

/**
 * Когда считать, что человек сошёл с маршрута и его пора строить заново.
 *
 * Выдержка здесь не украшение: городской GPS выбрасывает одиночные отсчёты за
 * сотню метров, и перестройка на каждом из них превратила бы поездку в
 * непрерывный пересчёт.
 */

export const OFF_ROUTE_M: Record<"walk" | "car", number> = { walk: 25, car: 40 };

/** Сколько отсчётов подряд должны лежать в стороне. */
export const OFF_ROUTE_STREAK = 3;

/** Пауза между перестройками: маршрутизатору нужно время, человеку — тоже. */
export const REROUTE_COOLDOWN_MS = 15_000;

export class OffRouteWatch {
  private readonly threshold: number;
  private streak = 0;
  // `null`, а не ноль: первая перестройка не должна ждать выдержку от начала
  // эпохи Unix — именно этим ноль и оборачивался.
  private lastRerouteAt: number | null = null;

  constructor(mode: RouteMode) {
    this.threshold = OFF_ROUTE_M[mode === "car" ? "car" : "walk"];
  }

  /** Лежит ли отсчёт в стороне от линии. */
  offRoute(distanceFromRoute: number): boolean {
    return !(distanceFromRoute <= this.threshold);
  }

  /** Отсчёт расстояния до линии → пора ли перестраивать. */
  feed(distanceFromRoute: number, nowMs: number): boolean {
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
