import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis } from "@/lib/redis";
import { readViewerRoutePrefs } from "@/lib/interests-read";
import { findStopsAlongRoute } from "@/lib/route-stops-read";

export const dynamic = "force-dynamic";

/** Ответ лежит в Redis десять минут: иначе каждый отсчёт GPS означал бы запрос в базу. */
const TTL = 600;

/** Линия длиннее этого к нам приходить не может: ответ маршрутизатора прорежен клиентом. */
const MAX_POINTS = 4000;

type Body = { coords?: unknown; mode?: unknown; product?: unknown; exclude?: unknown };

function parseCoords(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_POINTS) return null;
  const out: [number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const lon = Number(item[0]);
    const lat = Number(item[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    out.push([lon, lat]);
  }
  return out;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const coords = parseCoords(body.coords);
  if (!coords) return NextResponse.json({ error: "invalid coords" }, { status: 400 });

  // У транспорта остановок по пути нет: человек внутри вагона никуда не свернёт, и
  // список предлагал бы то, чего он сделать не может.
  const mode = body.mode === "walk" || body.mode === "car" ? body.mode : null;
  if (!mode) return NextResponse.json({ stops: [], hidden: 0, truncated: false });

  const product = typeof body.product === "string" && body.product ? body.product : null;
  // Цель маршрута — не «по пути», а то, куда человек едет: её из списка убирает клиент,
  // потому что только он знает, какую точку выбрал.
  const exclude = Array.isArray(body.exclude)
    ? body.exclude.filter((v): v is string => typeof v === "string").slice(0, 5)
    : [];

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const prefs = await readViewerRoutePrefs(userId);

  // Ключ — сама линия, набор интересов, коридор и товар: другой коридор это другой
  // ответ, и выдавать прежний было бы неправдой.
  const shape = createHash("sha1")
    .update(coords.map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join(";"))
    .digest("hex")
    .slice(0, 16);
  const cacheKey = `cmap:stops:v1:${shape}:${prefs.interests.join(",")}:${prefs.corridorMeters}:${product ?? ""}`;

  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(
        { ...JSON.parse(cached), alertMeters: prefs.alertMeters },
        { headers: { "x-cache": "hit" } },
      );
    }
  } catch {
    // Нет Redis — читаем базу: это два запроса, а не отказ.
  }

  try {
    const result = await findStopsAlongRoute({
      coords,
      interests: prefs.interests,
      corridorMeters: prefs.corridorMeters,
      productSlug: product,
      excludeIds: exclude,
    });
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", TTL);
    } catch {
      // best-effort
    }
    return NextResponse.json({ ...result, alertMeters: prefs.alertMeters }, { headers: { "x-cache": "miss" } });
  } catch {
    // Сбой чтения и «ничего по пути» — разные состояния: панель скажет «не узнали».
    return NextResponse.json({ error: "stops unavailable" }, { status: 502 });
  }
}
