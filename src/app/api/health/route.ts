import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    results.db = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (e) {
    results.db = { ok: false, error: String(e) };
  }

  const redisStart = Date.now();
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const pong = await redis.ping();
    results.redis = { ok: pong === "PONG", latencyMs: Date.now() - redisStart };
  } catch (e) {
    results.redis = { ok: false, error: String(e) };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return NextResponse.json(
    { ok: allOk, checks: results, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
