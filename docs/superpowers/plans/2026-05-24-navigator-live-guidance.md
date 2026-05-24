# Crypto Navigator — Live Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Start" button + live, follow-me navigation to the Crypto Navigator (walk mode only). The map auto-centers/rotates on the user's GPS, remaining distance and ETA update live, an "Off-route" badge surfaces a "Recompute" button beyond 30 m drift, and the screen stays awake via Wake Lock.

**Architecture:** Three small new modules — `src/lib/route-geometry.ts` (pure haversine + nearest-point-on-polyline math), `src/lib/wake-lock.ts` (thin `navigator.wakeLock` wrapper), `src/components/coin-detail/navigation-controller.ts` (class wrapping `watchPosition` + throttled callbacks). The existing `CryptoNavigator` client component grows three buttons (Start in POI popup + Start/Stop/Recompute in route summary) and a live summary view that swaps in when navigating. No backend / API / worker changes; the routing API already returns a LineString and we compute everything else on the client.

**Tech Stack:** Next.js 16 client component, MapLibre GL JS (already imported), browser `Geolocation`/`WakeLock` APIs, vitest for unit tests (existing config under `tests/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-05-24-navigator-live-guidance-design.md`

---

## File Structure

**Create:**
- `src/lib/route-geometry.ts` — `haversineMeters`, `nearestOnLineString`, `remainingMeters`. Pure, no DOM.
- `tests/lib/route-geometry.test.ts` — vitest unit tests for the above (must live under `tests/` to match the existing `vitest.config.ts` `include` pattern).
- `src/lib/wake-lock.ts` — `acquireWakeLock()` returning a handle with `release()`. Re-acquires on `visibilitychange`.
- `src/components/coin-detail/navigation-controller.ts` — `NavigationController` class with `start(cb)`, `stop()`, `updateRoute(coords)`.

**Modify:**
- `src/components/coin-detail/crypto-navigator.tsx` — import the three new modules, drop the local `distMeters` (replaced by `haversineMeters` from `route-geometry.ts`), add `navActive`/`navOffRoute`/`navRemaining` state, add `startNavigation()` / `stopNavigation()`, add three buttons (Start in `buildCard` for walk, ▶ Start + ■ Stop + ↻ Recompute in route summary bar), swap the route summary to live mode while navigating, cleanup in `useEffect` unmount.
- `src/app/globals.css` — append `.cmap-start` styles (mirrors `.cmap-route` but with a play-icon and the same accent fill).
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — append 9 keys under `cryptoMap`.

---

## Task 1: Pure route geometry library (TDD)

**Files:**
- Create: `src/lib/route-geometry.ts`
- Test: `tests/lib/route-geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/route-geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  nearestOnLineString,
  remainingMeters,
} from "@/lib/route-geometry";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters([14.42, 50.08], [14.42, 50.08])).toBe(0);
  });

  it("computes Moscow → St. Petersburg as ~635 km (±5 km)", () => {
    const moscow: [number, number] = [37.6173, 55.7558];
    const spb: [number, number] = [30.3351, 59.9343];
    const d = haversineMeters(moscow, spb);
    expect(d).toBeGreaterThan(630_000);
    expect(d).toBeLessThan(640_000);
  });
});

describe("nearestOnLineString", () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0], // ~111 km east at the equator
    [1, 1], // then ~111 km north
  ];

  it("returns 0 when the point sits exactly on the first vertex", () => {
    const r = nearestOnLineString([0, 0], line);
    expect(r.distance).toBeCloseTo(0, 1);
    expect(r.segmentIndex).toBe(0);
    expect(r.t).toBeCloseTo(0, 5);
  });

  it("projects a point onto the middle of the first segment", () => {
    const r = nearestOnLineString([0.5, 0], line);
    expect(r.distance).toBeLessThan(10); // on the line
    expect(r.segmentIndex).toBe(0);
    expect(r.t).toBeCloseTo(0.5, 2);
  });

  it("reports a sensible perpendicular distance for a point off the line", () => {
    // 0.001° at the equator ≈ 111 m
    const r = nearestOnLineString([0.5, 0.001], line);
    expect(r.distance).toBeGreaterThan(100);
    expect(r.distance).toBeLessThan(115);
    expect(r.segmentIndex).toBe(0);
  });

  it("does not divide by zero on a degenerate segment", () => {
    const degenerate: [number, number][] = [
      [0, 0],
      [0, 0], // zero-length
      [1, 0],
    ];
    const r = nearestOnLineString([0.5, 0], degenerate);
    expect(Number.isFinite(r.distance)).toBe(true);
    expect(r.distance).toBeLessThan(10);
  });
});

describe("remainingMeters", () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const seg0Len = haversineMeters(line[0], line[1]);
  const seg1Len = haversineMeters(line[1], line[2]);
  const total = seg0Len + seg1Len;

  it("returns 0 at the very end of the line", () => {
    expect(remainingMeters(line, 1, 1)).toBeCloseTo(0, 0);
  });

  it("returns the total length at the very start", () => {
    expect(remainingMeters(line, 0, 0)).toBeCloseTo(total, 0);
  });

  it("returns half of seg0 + all of seg1 from the middle of seg0", () => {
    const got = remainingMeters(line, 0, 0.5);
    expect(got).toBeCloseTo(seg0Len * 0.5 + seg1Len, -1); // tolerance: 10 m
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/route-geometry.test.ts`
Expected: All tests fail with "Cannot find module '@/lib/route-geometry'" or similar.

- [ ] **Step 3: Implement `src/lib/route-geometry.ts`**

Create `src/lib/route-geometry.ts` with this exact content:

```ts
// Pure geometry helpers for navigating along a polyline route.
// All coordinates are [lon, lat] tuples (GeoJSON order). No DOM, no I/O.

const R_EARTH_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const [aLon, aLat] = a;
  const [bLon, bLat] = b;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Project a lon/lat point onto a polyline. Uses an equirectangular local
// projection around the segment midpoint — accurate to < 0.1% for segments
// shorter than a few km, which is what we deal with in walking routes.
export type ProjectionResult = {
  point: [number, number];   // lon/lat of the projected point
  segmentIndex: number;       // index of segment start vertex (0-based)
  t: number;                  // 0..1 along the segment
  distance: number;           // metres from input point to projected point
};

function projectOntoSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; t: number; distance: number } {
  // Convert to a tangent plane at the midpoint of the segment.
  const midLat = (a[1] + b[1]) / 2;
  const mPerDegLat = 111_132;
  const mPerDegLon = 111_320 * Math.cos(toRad(midLat));

  const ax = a[0] * mPerDegLon;
  const ay = a[1] * mPerDegLat;
  const bx = b[0] * mPerDegLon;
  const by = b[1] * mPerDegLat;
  const px = p[0] * mPerDegLon;
  const py = p[1] * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t: number;
  if (len2 < 1e-9) {
    // Degenerate (zero-length) segment — pin to A.
    t = 0;
  } else {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const projx = ax + t * dx;
  const projy = ay + t * dy;
  const distance = Math.hypot(px - projx, py - projy);
  return {
    point: [projx / mPerDegLon, projy / mPerDegLat],
    t,
    distance,
  };
}

export function nearestOnLineString(
  p: [number, number],
  coords: [number, number][],
): ProjectionResult {
  if (coords.length === 0) {
    return { point: p, segmentIndex: 0, t: 0, distance: Number.POSITIVE_INFINITY };
  }
  if (coords.length === 1) {
    return {
      point: coords[0],
      segmentIndex: 0,
      t: 0,
      distance: haversineMeters(p, coords[0]),
    };
  }
  let best: ProjectionResult = {
    point: coords[0],
    segmentIndex: 0,
    t: 0,
    distance: Number.POSITIVE_INFINITY,
  };
  for (let i = 0; i < coords.length - 1; i++) {
    const r = projectOntoSegment(p, coords[i], coords[i + 1]);
    if (r.distance < best.distance) {
      best = {
        point: r.point,
        segmentIndex: i,
        t: r.t,
        distance: r.distance,
      };
    }
  }
  return best;
}

export function remainingMeters(
  coords: [number, number][],
  segmentIndex: number,
  t: number,
): number {
  if (coords.length < 2) return 0;
  if (segmentIndex < 0 || segmentIndex >= coords.length - 1) return 0;
  // Distance from the projected point to the end of its segment.
  const segStart = coords[segmentIndex];
  const segEnd = coords[segmentIndex + 1];
  const segLen = haversineMeters(segStart, segEnd);
  let total = segLen * (1 - Math.max(0, Math.min(1, t)));
  // Plus full length of each subsequent segment.
  for (let i = segmentIndex + 1; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i], coords[i + 1]);
  }
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/route-geometry.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/route-geometry.ts tests/lib/route-geometry.test.ts
git commit -m "feat(navigator): pure polyline geometry helpers (haversine, project, remaining)"
```

---

## Task 2: Wake Lock wrapper

**Files:**
- Create: `src/lib/wake-lock.ts`

- [ ] **Step 1: Implement `src/lib/wake-lock.ts`**

```ts
// Thin wrapper around the Screen Wake Lock API.
// Returns null when unsupported (Safari < 16.4, Firefox < 126, http://).
// Re-acquires automatically on `document.visibilitychange === "visible"` —
// Safari releases the lock silently when the tab is backgrounded.

export type WakeLockHandle = {
  release: () => void;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  released: boolean;
  addEventListener: (event: string, listener: () => void) => void;
};

type WakeLockApi = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

function getApi(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return wl ?? null;
}

export async function acquireWakeLock(): Promise<WakeLockHandle | null> {
  const api = getApi();
  if (!api) return null;

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async () => {
    if (released) return;
    try {
      sentinel = await api.request("screen");
    } catch {
      sentinel = null;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) {
      void acquire();
    }
  };

  await acquire();
  if (!sentinel) return null;

  document.addEventListener("visibilitychange", onVisible);

  return {
    release: () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v "bot/__tests__/session.test.ts\|tests/telegram-auth.test.ts" | tail -20`
Expected: no errors mentioning `src/lib/wake-lock.ts`. (The two test files listed are pre-existing TS errors unrelated to this work — filter them out.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wake-lock.ts
git commit -m "feat(navigator): screen wake lock helper with auto re-acquire"
```

---

## Task 3: NavigationController

**Files:**
- Create: `src/components/coin-detail/navigation-controller.ts`

- [ ] **Step 1: Implement the controller**

Create `src/components/coin-detail/navigation-controller.ts`:

```ts
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
    if (this.watchId !== null) return; // already running
    this.callbacks = cb;
    this.wakeLock = await acquireWakeLock(); // null is fine (unsupported)

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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "navigation-controller|route-geometry|wake-lock" | head -20`
Expected: no output (no errors in the new files).

- [ ] **Step 3: Commit**

```bash
git add src/components/coin-detail/navigation-controller.ts
git commit -m "feat(navigator): NavigationController with watchPosition + throttled progress"
```

---

## Task 4: Wire UI into `crypto-navigator.tsx`

**Files:**
- Modify: `src/components/coin-detail/crypto-navigator.tsx`

This task touches several spots in the same file. Follow steps in order.

- [ ] **Step 1: Add imports**

Near the top of `src/components/coin-detail/crypto-navigator.tsx`, alongside the existing `import maplibregl, ... from "maplibre-gl";` line, add:

```tsx
import { NavigationController, type NavigationCallbacks } from "./navigation-controller";
import { haversineMeters } from "@/lib/route-geometry";
```

- [ ] **Step 2: Delete the local `distMeters` helper**

Search for `function distMeters(aLat: number, aLon: number, bLat: number, bLon: number)` near the bottom of the file (≈ line 790). Delete the whole function (≈ 10 lines, ending at the closing `}`).

Then replace every call site `distMeters(aLat, aLon, bLat, bLon)` with `haversineMeters([aLon, aLat], [bLon, bLat])`. Use Grep first to enumerate call sites:

Run: `grep -n "distMeters(" src/components/coin-detail/crypto-navigator.tsx`

For each match, switch to the new signature. (The new helper takes `[lon, lat]` tuples and returns metres.)

- [ ] **Step 3: Add navigation state + refs**

Inside the `CryptoNavigator` component, alongside the existing state declarations (look for `const [route, setRoute] = useState…`), add:

```tsx
const [navActive, setNavActive] = useState(false);
const [navOffRoute, setNavOffRoute] = useState<number | null>(null);
const [navRemaining, setNavRemaining] = useState<{ m: number; sec: number } | null>(null);
const [navError, setNavError] = useState<string | null>(null);
const navControllerRef = useRef<NavigationController | null>(null);
```

- [ ] **Step 4: Add start/stop helpers**

Below `buildRoute` (and `clearRoute`) — anywhere inside the component before the `return (` — paste:

```tsx
const startNavigation = useCallback(async () => {
  const map = mapRef.current;
  const r = route;
  if (!map || !r || r.mode !== "walk") return;
  if (navControllerRef.current) return;

  setStatus(t("navStarting"));
  setNavError(null);

  const ctl = new NavigationController(r.geometry.coordinates);
  navControllerRef.current = ctl;

  const cb: NavigationCallbacks = {
    onPosition: (pos) => {
      const center: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      const bearing =
        typeof pos.coords.heading === "number" &&
        typeof pos.coords.speed === "number" &&
        pos.coords.speed > 0.5
          ? pos.coords.heading
          : map.getBearing();
      map.easeTo({ center, bearing, pitch: 45, duration: 800 });
    },
    onProgress: (m, sec) => {
      setNavRemaining({ m, sec });
      setStatus(null);
    },
    onOffRoute: (dist) => {
      setNavOffRoute(dist);
    },
    onArrival: () => {
      setStatus(t("arrived"));
      window.setTimeout(() => stopNavigation(), 5000);
    },
    onError: (code) => {
      if (code === "permission_denied") setNavError(t("permissionDenied"));
      else setNavError(t("permissionDenied")); // generic fallback
      void stopNavigation();
    },
  };

  setNavActive(true);
  map.easeTo({ zoom: 17, duration: 600 });
  await ctl.start(cb);
}, [route, t]);

const stopNavigation = useCallback(() => {
  navControllerRef.current?.stop();
  navControllerRef.current = null;
  setNavActive(false);
  setNavOffRoute(null);
  setNavRemaining(null);
  setStatus(null);
  const map = mapRef.current;
  if (map) {
    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }
}, []);
```

- [ ] **Step 5: Keep controller's route in sync after recompute**

Find the existing `buildRoute` (the one already in the file). At the end of its success path (after `setRoute(parsedRoute)` or equivalent), append:

```tsx
if (navControllerRef.current && parsedRoute) {
  navControllerRef.current.updateRoute(parsedRoute.geometry.coordinates);
}
```

(`parsedRoute` is whatever variable holds the freshly parsed route — match the existing local name in `buildRoute`.)

- [ ] **Step 6: Stop navigation on unmount**

Find the `useEffect` that creates the map (the one with `mapRef.current = map`). Add the controller cleanup to its return:

```tsx
return () => {
  navControllerRef.current?.stop();
  navControllerRef.current = null;
  // ... existing cleanup (map.remove() etc.) stays unchanged
};
```

If there is no existing return inside that effect, add one that only stops the controller. Keep any pre-existing cleanup intact.

- [ ] **Step 7: Render Start/Stop/Recompute in the route summary bar**

In the `{/* Route summary */}` block (≈ line 629–667), inside the `{route && (` branch, **right before** the existing `<button … onClick={clearRoute}>` ("Clear route"), insert:

```tsx
{route.mode === "walk" && !navActive && (
  <button
    type="button"
    onClick={startNavigation}
    className="text-accent hover:opacity-80 font-medium"
    aria-label={t("start")}
  >
    ▶ {t("start")}
  </button>
)}
{navActive && (
  <>
    <button
      type="button"
      onClick={stopNavigation}
      className="text-down hover:opacity-80 font-medium"
      aria-label={t("stop")}
    >
      ■ {t("stop")}
    </button>
    {navOffRoute !== null && navOffRoute > 30 && (
      <button
        type="button"
        onClick={() => buildRoute()}
        className="text-accent hover:opacity-80 font-medium"
        aria-label={t("recompute")}
      >
        ↻ {t("recompute")}
      </button>
    )}
  </>
)}
```

- [ ] **Step 8: Swap the duration/distance line for the live one while navigating**

In the same Route summary block, find the line:

```tsx
<span className="text-muted">
  {t("duration")}: <span className="num text-foreground">{Math.round(route.duration / 60)} min</span>
</span>
```

Wrap it so it only renders when **not** navigating, and add a parallel live line for the navigating case. Replace just that `<span>` with:

```tsx
{!navActive && (
  <span className="text-muted">
    {t("duration")}: <span className="num text-foreground">{Math.round(route.duration / 60)} min</span>
  </span>
)}
{navActive && navRemaining && (
  <span className="text-muted">
    {t("remaining")}:{" "}
    <span className="num text-foreground">
      {(navRemaining.m / 1000).toFixed(navRemaining.m < 1000 ? 2 : 1)} km
    </span>
    {" · "}
    <span className="num text-foreground">
      {t("etaMin", { min: Math.max(1, Math.round(navRemaining.sec / 60)) })}
    </span>
  </span>
)}
```

The static `distance` row below stays as-is (it shows the original total length — useful even while navigating, no need to hide it).

- [ ] **Step 9: Surface `navError` to the user**

Below `{status && <span className="text-accent">{status}</span>}`, add:

```tsx
{navError && <span className="text-down">{navError}</span>}
```

- [ ] **Step 10: Add `.cmap-start` button to the POI popup card (walk mode only)**

Find `buildCard()` (≈ line 734). At the end of the inner template literal, **after** the existing `<button type="button" class="cmap-street ...">…</button>` line, add a conditional walk-only Start button. Because `buildCard` doesn't currently know about `mode`, pass it in: change the signature to

```tsx
function buildCard(p: PoiProps, t: Translator, near: boolean, showStart: boolean): HTMLDivElement {
```

then at every call site of `buildCard(...)` in the file, append `mode === "walk"` (the current `mode` state) as the fourth argument.

Inside `buildCard`, after the street-view `<button>` line, add:

```ts
${showStart ? `<button type="button" class="cmap-start">▶ ${escapeHtml(t("start"))}</button>` : ""}
```

And in the popup wiring (the `openPoiPopup` function inside the `map.on("load", () => { ... })` block — search for `.cmap-route` and `.cmap-street` listeners), add a third listener for `.cmap-start`:

```tsx
el.querySelector<HTMLButtonElement>(".cmap-start")?.addEventListener("click", async () => {
  setDestination(lonlat, p.name);
  popup.remove();
  // setDestination triggers buildRoute() which sets route async; wait a tick.
  // The simplest correct way: when `route` settles for THIS destination,
  // startNavigation gets re-called by the effect below.
  setPendingStart(true);
});
```

…and add the matching state + effect near other state declarations:

```tsx
const [pendingStart, setPendingStart] = useState(false);

useEffect(() => {
  if (pendingStart && route && route.mode === "walk") {
    setPendingStart(false);
    void startNavigation();
  }
}, [pendingStart, route, startNavigation]);
```

- [ ] **Step 11: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "crypto-navigator|navigation-controller|route-geometry|wake-lock" | head -30`
Expected: empty output. (Pre-existing errors in `bot/__tests__/session.test.ts` and `tests/telegram-auth.test.ts` are unrelated.)

Then: `npm run build`
Expected: build succeeds.

- [ ] **Step 12: Commit**

```bash
git add src/components/coin-detail/crypto-navigator.tsx
git commit -m "feat(navigator): wire Start/Stop/Recompute + live remaining/ETA UI"
```

---

## Task 5: `.cmap-start` button styling

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Append `.cmap-start` rule**

Find the existing `.cmap-route { ... }` rule in `src/app/globals.css` (search for `.cmap-route`). Immediately after `.cmap-route:hover { filter: brightness(1.06); }`, append:

```css
.cmap-start {
  margin-top: 6px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #fe5c04;
  color: #0a0a0a;
  border: none;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s ease;
}
.cmap-start:hover { filter: brightness(1.06); }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "style(navigator): .cmap-start button styling (accent fill, full width)"
```

---

## Task 6: i18n — Russian

**Files:**
- Modify: `messages/ru.json` — append 9 keys inside `cryptoMap`.

- [ ] **Step 1: Locate the `cryptoMap` block**

Open `messages/ru.json` and find `"cryptoMap": { ... }`. The block already contains keys like `routeHere`, `duration`, `mode_walk`, `streetview`, `posGps`.

- [ ] **Step 2: Append the new keys**

Inside `"cryptoMap"`, add these 9 keys at the end of the block (mind the comma on the preceding key):

```json
"start": "Старт",
"stop": "Стоп",
"recompute": "Пересчитать",
"remaining": "Осталось",
"etaMin": "{min} мин",
"arrived": "Вы прибыли",
"permissionDenied": "Доступ к геолокации запрещён. Включите его в настройках браузера, чтобы вести по маршруту.",
"startOnlyWalk": "Доступно только для пешеходного маршрута",
"navStarting": "Запрашиваю GPS…"
```

- [ ] **Step 3: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/ru.json','utf8'))" && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add messages/ru.json
git commit -m "i18n(navigator): live-guidance strings (ru)"
```

---

## Task 7: i18n — English

**Files:**
- Modify: `messages/en.json`

- [ ] **Step 1: Append the same 9 keys inside `cryptoMap`**

```json
"start": "Start",
"stop": "Stop",
"recompute": "Recompute",
"remaining": "Remaining",
"etaMin": "{min} min",
"arrived": "You have arrived",
"permissionDenied": "Geolocation is blocked. Enable it in your browser settings to navigate along the route.",
"startOnlyWalk": "Available only for walking routes",
"navStarting": "Requesting GPS…"
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json
git commit -m "i18n(navigator): live-guidance strings (en)"
```

---

## Task 8: i18n — remaining 8 locales

**Files:**
- Modify: `messages/{de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json`

For each file, add the same 9 keys inside the `cryptoMap` block, translated.

- [ ] **Step 1: `messages/de.json`**

```json
"start": "Start",
"stop": "Stopp",
"recompute": "Neu berechnen",
"remaining": "Verbleibend",
"etaMin": "{min} Min",
"arrived": "Sie sind am Ziel",
"permissionDenied": "Standortzugriff blockiert. Aktivieren Sie ihn in den Browsereinstellungen, um geführt zu werden.",
"startOnlyWalk": "Nur für Fußrouten verfügbar",
"navStarting": "GPS wird angefordert…"
```

- [ ] **Step 2: `messages/es.json`**

```json
"start": "Iniciar",
"stop": "Detener",
"recompute": "Recalcular",
"remaining": "Restante",
"etaMin": "{min} min",
"arrived": "Has llegado",
"permissionDenied": "Geolocalización bloqueada. Actívala en los ajustes del navegador para seguir la ruta.",
"startOnlyWalk": "Disponible solo para rutas a pie",
"navStarting": "Solicitando GPS…"
```

- [ ] **Step 3: `messages/fr.json`**

```json
"start": "Démarrer",
"stop": "Arrêter",
"recompute": "Recalculer",
"remaining": "Restant",
"etaMin": "{min} min",
"arrived": "Vous êtes arrivé",
"permissionDenied": "La géolocalisation est bloquée. Activez-la dans les paramètres du navigateur pour suivre l'itinéraire.",
"startOnlyWalk": "Disponible uniquement pour les itinéraires à pied",
"navStarting": "Demande du GPS…"
```

- [ ] **Step 4: `messages/ja.json`**

```json
"start": "スタート",
"stop": "ストップ",
"recompute": "再計算",
"remaining": "残り",
"etaMin": "{min} 分",
"arrived": "目的地に到着しました",
"permissionDenied": "位置情報がブロックされています。ブラウザの設定で有効にしてください。",
"startOnlyWalk": "徒歩ルートでのみ利用可能",
"navStarting": "GPS を要求中…"
```

- [ ] **Step 5: `messages/ko.json`**

```json
"start": "시작",
"stop": "정지",
"recompute": "다시 계산",
"remaining": "남음",
"etaMin": "{min} 분",
"arrived": "도착했습니다",
"permissionDenied": "위치 정보가 차단되었습니다. 브라우저 설정에서 허용하세요.",
"startOnlyWalk": "도보 경로에서만 사용 가능",
"navStarting": "GPS 요청 중…"
```

- [ ] **Step 6: `messages/pt-BR.json`**

```json
"start": "Iniciar",
"stop": "Parar",
"recompute": "Recalcular",
"remaining": "Restante",
"etaMin": "{min} min",
"arrived": "Você chegou",
"permissionDenied": "Geolocalização bloqueada. Ative-a nas configurações do navegador para seguir a rota.",
"startOnlyWalk": "Disponível apenas para rotas a pé",
"navStarting": "Solicitando GPS…"
```

- [ ] **Step 7: `messages/tr.json`**

```json
"start": "Başlat",
"stop": "Durdur",
"recompute": "Yeniden hesapla",
"remaining": "Kalan",
"etaMin": "{min} dk",
"arrived": "Hedefe ulaştınız",
"permissionDenied": "Konum erişimi engellendi. Yönlendirme için tarayıcı ayarlarından etkinleştirin.",
"startOnlyWalk": "Yalnızca yürüyüş rotaları için kullanılabilir",
"navStarting": "GPS isteniyor…"
```

- [ ] **Step 8: `messages/zh-CN.json`**

```json
"start": "开始",
"stop": "停止",
"recompute": "重新计算",
"remaining": "剩余",
"etaMin": "{min} 分钟",
"arrived": "您已到达",
"permissionDenied": "位置访问已被阻止。请在浏览器设置中开启以进行导航。",
"startOnlyWalk": "仅适用于步行路线",
"navStarting": "正在请求 GPS…"
```

- [ ] **Step 9: Validate all 8 parse**

```bash
for f in de es fr ja ko pt-BR tr zh-CN; do
  node -e "JSON.parse(require('fs').readFileSync('messages/${f}.json','utf8'))" || echo "BROKEN: $f"
done
echo "validation done"
```
Expected: no `BROKEN:` lines.

- [ ] **Step 10: Commit**

```bash
git add messages/de.json messages/es.json messages/fr.json messages/ja.json \
        messages/ko.json messages/pt-BR.json messages/tr.json messages/zh-CN.json
git commit -m "i18n(navigator): live-guidance strings (de, es, fr, ja, ko, pt-BR, tr, zh-CN)"
```

---

## Task 9: Build, deploy, manual smoke test, push

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: route-geometry tests pass; any pre-existing failures unrelated to this work can be tolerated, but no NEW failures.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Restart web**

Run: `pm2 restart trientes-web && pm2 save`
Expected: process restarts cleanly. Worker is NOT restarted (no `src/lib` consumer touched in worker).

- [ ] **Step 4: Smoke — start navigation in DevTools**

Open https://trientes.org/ru/coin/bitcoin in a desktop browser. In DevTools → Sensors, set location to a city with POIs (e.g. Prague 50.0875, 14.4216). On the map, ensure `walk` mode is selected, click any POI, then click ▶ Старт in the route summary bar.

Verify:
- Status flashes "Запрашиваю GPS…"
- Camera tilts to pitch ≈ 45 and recenters on the simulated point.
- "Осталось: X.X km · N мин" appears, replacing the static "Time" line.
- Stop button is visible.

- [ ] **Step 5: Smoke — off-route → recompute**

In DevTools → Sensors, move the simulated point off the route by ~50 m (perpendicular to the line).

Verify:
- Within 1–2 seconds, ↻ Пересчитать button appears.
- Click it. Route reshapes around the new starting point; navigation continues without re-clicking Start.

- [ ] **Step 6: Smoke — arrival**

Set the simulated point within 25 m of the destination POI.

Verify:
- Status banner "Вы прибыли" appears.
- ~5 seconds later, navigation stops automatically: Stop button disappears, pitch returns to 0.

- [ ] **Step 7: Smoke — permission denied**

In a fresh incognito window, deny geolocation when prompted. Click Старт.

Verify:
- Red text appears in the route summary: "Доступ к геолокации запрещён…".
- Stop/Recompute buttons go away.

- [ ] **Step 8: Smoke — Start button in POI popup**

Click any POI to open its popup. With walk mode selected, verify the orange ▶ Старт button appears at the bottom of the card. Click it. The popup closes, the route builds, and navigation auto-starts.

Switch to car mode, reopen a POI popup. Verify the ▶ Старт button is NOT shown (only Route + Surroundings).

- [ ] **Step 9: Smoke — Stop manually**

Mid-route, click ■ Стоп. Verify camera returns to pitch 0, the live "Осталось" disappears, the static "Time"/"Distance" returns.

- [ ] **Step 10: Push**

Run: `git push origin main`
Expected: push succeeds.

- [ ] **Step 11: Screenshot**

Take a screenshot of the route summary bar mid-navigation (with Stop + live Remaining visible) and save it as `navigator-live-deployed.png` in the repo root.

---

## Out-of-Scope (explicit non-tasks)

- Voice / turn-by-turn instructions — requires `/api/crypto-map/directions` to return OSRM steps. Separate slice.
- Car or transit live guidance.
- Background-tab continuation — when the tab is hidden, the wake lock is silently re-acquired on return, but watchPosition itself may pause depending on the browser. Acceptable for slice 1.
- Persisting navigation state across page navigations.
- Heading lock to magnetometer/compass at low speed. We just hold the prior bearing when speed < 0.5 m/s.
