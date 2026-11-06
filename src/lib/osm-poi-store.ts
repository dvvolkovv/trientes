// Read/write side of the local BTC Map mirror (see src/lib/btcmap.ts for why it exists).
//
// Write: the worker syncs the dump nightly.
// Read: /api/crypto-map/poi asks for a viewport and gets Poi[] back, parsed by the
// very same parseOverpassElements() the live Overpass path used — the stored `tags`
// are untouched OSM tags, so a row round-trips into an element of the shape that
// function already expects.

import { prisma } from "@/lib/prisma";
import { parseOverpassElements, type Bbox, type Poi } from "@/lib/crypto-map";
import { parseBtcMapElements, parseBtcMapDeletedIds, fetchBtcMapElements } from "@/lib/btcmap";

// A dense city viewport holds a few hundred points at most; the cap keeps a
// zoomed-out request from dragging the whole table through the serializer.
const BBOX_LIMIT = 600;

export async function fetchOsmPoisInBbox(bbox: Bbox, coinTags: string[]): Promise<Poi[]> {
  const rows = await prisma.osmCryptoPoi.findMany({
    where: {
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    take: BBOX_LIMIT,
    select: { type: true, osmId: true, lat: true, lon: true, tags: true },
  });
  const elements = rows.map((r) => ({
    type: r.type,
    id: Number(r.osmId),
    lat: r.lat,
    lon: r.lon,
    tags: (r.tags ?? {}) as Record<string, string>,
  }));
  return parseOverpassElements({ elements }, coinTags);
}

export type OsmSyncResult = { upserted: number; deleted: number; incremental: boolean };

// Postgres caps a statement at 65535 bind parameters; 6 columns per row means
// chunks well under that, and keeps each transaction short enough not to block
// readers on the live box.
const CHUNK = 500;

/**
 * Mirror BTC Map into `OsmCryptoPoi`.
 *
 * With an empty table it pulls the full dump (~43k elements, ~40 MB); afterwards
 * it asks only for what changed since the last sync, which is a few dozen rows.
 * The `since` window is deliberately backdated by a day so a place edited while
 * the previous sync was mid-flight isn't skipped.
 */
export async function syncOsmCryptoPois(): Promise<OsmSyncResult> {
  const existing = await prisma.osmCryptoPoi.count();
  const last = existing
    ? await prisma.osmCryptoPoi.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } })
    : null;
  const since = last ? new Date(last.syncedAt.getTime() - 24 * 3600_000).toISOString() : undefined;

  const raw = await fetchBtcMapElements(since);
  const rows = parseBtcMapElements(raw);
  const goneIds = parseBtcMapDeletedIds(raw);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // createMany + skipDuplicates can't refresh an existing row, and 43k
    // individual upserts would take minutes — so delete-then-insert per chunk.
    await prisma.$transaction([
      prisma.osmCryptoPoi.deleteMany({ where: { id: { in: chunk.map((r) => r.id) } } }),
      prisma.osmCryptoPoi.createMany({
        data: chunk.map((r) => ({
          id: r.id,
          type: r.type,
          osmId: r.osmId,
          lat: r.lat,
          lon: r.lon,
          tags: r.tags,
        })),
      }),
    ]);
    upserted += chunk.length;
  }

  let deleted = 0;
  for (let i = 0; i < goneIds.length; i += CHUNK) {
    const res = await prisma.osmCryptoPoi.deleteMany({ where: { id: { in: goneIds.slice(i, i + CHUNK) } } });
    deleted += res.count;
  }

  return { upserted, deleted, incremental: Boolean(since) };
}
