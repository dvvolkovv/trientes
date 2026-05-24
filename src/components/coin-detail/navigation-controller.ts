import { nearestOnLineString, remainingMeters } from "@/lib/route-geometry";
import { acquireWakeLock, type WakeLockHandle } from "@/lib/wake-lock";

export type NavigationCallbacks = {
  onPosition: (pos: GeolocationPosition) => void;
  onProgress: (remainingMeters: number, etaSeconds: number) => void;
  onOffRoute: (distanceFromRouteMeters: number | null) => void;
  onArrival: () => void;
  onError: (message: string) => void;
};

const DEFAULT_WALK_SPEED_MPS = 1.35;
const ARRIVAL_RADIUS_M = 25;
const OFF_ROUTE_THRESHOLD_M = 30;
const MIN_UPDATE_INTERVAL_MS = 1000;
const SPEED_EMA_ALPHA = 0.3;

export class NavigationController {
  private routeCoords: [number, number][];
  private watchId: number | null = null;
  private wakeLock: WakeLockHandle | null = null;
  private lastUpdateAt = 0;
  private smoothedSpeedMps = DEFAULT_WALK_SPEED_MPS;
  private callbacks: NavigationCallbacks | null = null;
  private arrived = false;

  constructor(routeCoords: [number, number][]) {
    this.routeCoords = routeCoords;
  }

  updateRoute(newCoords: [number, number][]): void {
    this.routeCoords = newCoords;
    this.arrived = false;
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

    cb.onPosition(pos);

    const now = Date.now();
    if (now - this.lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
    this.lastUpdateAt = now;

    if (this.routeCoords.length < 2) return;

    const p: [number, number] = [pos.coords.longitude, pos.coords.latitude];
    const projection = nearestOnLineString(p, this.routeCoords);

    if (projection.distance > OFF_ROUTE_THRESHOLD_M) {
      cb.onOffRoute(projection.distance);
      return;
    }
    cb.onOffRoute(null);

    const remaining = remainingMeters(
      this.routeCoords,
      projection.segmentIndex,
      projection.t,
    );

    if (typeof pos.coords.speed === "number" && pos.coords.speed > 0.3) {
      this.smoothedSpeedMps =
        SPEED_EMA_ALPHA * pos.coords.speed +
        (1 - SPEED_EMA_ALPHA) * this.smoothedSpeedMps;
    }
    const eta = remaining / Math.max(0.5, this.smoothedSpeedMps);

    cb.onProgress(remaining, eta);

    if (remaining <= ARRIVAL_RADIUS_M && !this.arrived) {
      this.arrived = true;
      cb.onArrival();
    }
  }
}
