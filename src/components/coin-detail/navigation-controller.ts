import type { RouteMode } from "@/lib/crypto-map";
import { LOOK_AHEAD_M } from "@/lib/nav-camera";
import { OffRouteWatch } from "@/lib/nav-offroute";
import { bearingAlong, nearestOnLineString, remainingMeters } from "@/lib/route-geometry";
import { acquireWakeLock, type WakeLockHandle } from "@/lib/wake-lock";

/**
 * Всё, что контроллер знает о текущем положении, одним сообщением.
 *
 * Прежде это были три колбэка — положение, продвижение и сход с маршрута, — и
 * сошедший с линии переставал получать остаток и ETA: полоса ведения замирала
 * ровно тогда, когда человеку нужнее всего понять, что происходит.
 */
export type NavUpdate = {
  /** Сырой отсчёт GPS. */
  position: [number, number];
  /** Точка на линии маршрута; `null`, когда человек от неё в стороне. */
  snapped: [number, number] | null;
  /** Курс линии впереди — им крутится карта. */
  routeBearing: number | null;
  /** Курс по компасу телефона; на скорости врёт, часто отсутствует вовсе. */
  gpsBearing: number | null;
  speedMps: number;
  remainingMeters: number;
  etaSeconds: number;
  /** Сколько метров в стороне от линии; `null` — на маршруте. */
  offRouteMeters: number | null;
};

export type NavigationCallbacks = {
  onUpdate: (u: NavUpdate) => void;
  /** Сход подтверждён выдержкой — маршрут пора строить заново от этой точки. */
  onReroute: (position: [number, number]) => void;
  onArrival: () => void;
  onError: (message: string) => void;
};

const DEFAULT_WALK_SPEED_MPS = 1.35;
const ARRIVAL_RADIUS_M = 25;
const MIN_UPDATE_INTERVAL_MS = 500;
const SPEED_EMA_ALPHA = 0.3;

export class NavigationController {
  private routeCoords: [number, number][];
  private watch: OffRouteWatch;
  private watchId: number | null = null;
  private wakeLock: WakeLockHandle | null = null;
  private lastUpdateAt = 0;
  private smoothedSpeedMps = DEFAULT_WALK_SPEED_MPS;
  private callbacks: NavigationCallbacks | null = null;
  private arrived = false;

  constructor(routeCoords: [number, number][], mode: RouteMode) {
    this.routeCoords = routeCoords;
    this.watch = new OffRouteWatch(mode);
  }

  updateRoute(newCoords: [number, number][], mode?: RouteMode): void {
    this.routeCoords = newCoords;
    this.arrived = false;
    if (mode) this.watch = new OffRouteWatch(mode);
    this.watch.routeChanged(Date.now());
  }

  async start(cb: NavigationCallbacks): Promise<void> {
    if (this.watchId !== null) return;
    this.callbacks = cb;
    this.wakeLock = await acquireWakeLock();

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      cb.onError("geolocation_unavailable");
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) cb.onError("permission_denied");
        else cb.onError("geolocation_error");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null && navigator?.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.wakeLock?.release();
    this.wakeLock = null;
    this.callbacks = null;
    this.arrived = false;
  }

  private handlePosition(pos: GeolocationPosition): void {
    const cb = this.callbacks;
    if (!cb) return;

    const now = Date.now();
    if (now - this.lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
    this.lastUpdateAt = now;

    const p: [number, number] = [pos.coords.longitude, pos.coords.latitude];
    const gpsBearing =
      typeof pos.coords.heading === "number" &&
      Number.isFinite(pos.coords.heading) &&
      typeof pos.coords.speed === "number" &&
      pos.coords.speed > 0.5
        ? pos.coords.heading
        : null;

    if (typeof pos.coords.speed === "number" && pos.coords.speed > 0.3) {
      this.smoothedSpeedMps =
        SPEED_EMA_ALPHA * pos.coords.speed + (1 - SPEED_EMA_ALPHA) * this.smoothedSpeedMps;
    }

    if (this.routeCoords.length < 2) {
      cb.onUpdate({
        position: p,
        snapped: null,
        routeBearing: null,
        gpsBearing,
        speedMps: this.smoothedSpeedMps,
        remainingMeters: 0,
        etaSeconds: 0,
        offRouteMeters: null,
      });
      return;
    }

    const projection = nearestOnLineString(p, this.routeCoords);
    const off = this.watch.offRoute(projection.distance);
    const remaining = remainingMeters(this.routeCoords, projection.segmentIndex, projection.t);

    cb.onUpdate({
      position: p,
      snapped: off ? null : projection.point,
      routeBearing: bearingAlong(
        this.routeCoords,
        projection.segmentIndex,
        projection.t,
        LOOK_AHEAD_M,
      ),
      gpsBearing,
      speedMps: this.smoothedSpeedMps,
      remainingMeters: remaining,
      etaSeconds: remaining / Math.max(0.5, this.smoothedSpeedMps),
      offRouteMeters: off ? projection.distance : null,
    });

    if (this.watch.feed(projection.distance, now)) {
      cb.onReroute(p);
      return;
    }
    if (off) return;

    if (remaining <= ARRIVAL_RADIUS_M && !this.arrived) {
      this.arrived = true;
      cb.onArrival();
    }
  }
}
