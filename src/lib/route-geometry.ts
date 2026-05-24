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

export type ProjectionResult = {
  point: [number, number];
  segmentIndex: number;
  t: number;
  distance: number;
};

// Local equirectangular projection around segment midpoint — accurate to
// well under 1% for the sub-km segments we deal with in walking routes.
function projectOntoSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; t: number; distance: number } {
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
  const segStart = coords[segmentIndex];
  const segEnd = coords[segmentIndex + 1];
  const segLen = haversineMeters(segStart, segEnd);
  let total = segLen * (1 - Math.max(0, Math.min(1, t)));
  for (let i = segmentIndex + 1; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i], coords[i + 1]);
  }
  return total;
}
