// Worker-side evaluator for PriceAlert rows. Reads the live price (Binance WS
// for top 20, CoinGecko snapshot for everything else) and fires GTE/LTE alerts
// with a 3% hysteresis re-arm: once an alert triggers, it stays "triggered"
// until the price moves at least 3% back through the threshold.

import type { PrismaClient, AlertOp } from "@prisma/client";
import type { Redis } from "ioredis";
import { notifyUser } from "@/lib/notify";

const HYSTERESIS_PCT = 0.03;

type Deps = {
  prisma: PrismaClient;
  redis: Pick<Redis, "get">;
  // Allow tests / callers to inject the notifier (e.g. capture calls).
  notify?: typeof notifyUser;
};

export type EvalSummary = {
  scanned: number;
  fired: number;
  rearmed: number;
  skipped: number;
};

async function readPrice(redis: Deps["redis"], prisma: PrismaClient, coinId: string): Promise<number | null> {
  try {
    const liveRaw = await redis.get(`live:price:${coinId}`);
    if (liveRaw) {
      const parsed = JSON.parse(liveRaw) as { price?: number };
      if (typeof parsed.price === "number" && Number.isFinite(parsed.price)) return parsed.price;
    }
  } catch {
    /* fall through */
  }
  try {
    const snapRaw = await redis.get(`snapshot:coin:${coinId}`);
    if (snapRaw) {
      const parsed = JSON.parse(snapRaw) as { priceUsd?: number };
      if (typeof parsed.priceUsd === "number" && Number.isFinite(parsed.priceUsd)) return parsed.priceUsd;
    }
  } catch {
    /* fall through */
  }
  // Last resort — DB snapshot. Slower but always there.
  const row = await prisma.coinSnapshot.findFirst({
    where: { coinId },
    orderBy: { fetchedAt: "desc" },
    select: { priceUsd: true },
  });
  return row ? Number(row.priceUsd) : null;
}

export function fires(op: AlertOp, price: number, threshold: number): boolean {
  return op === "GTE" ? price >= threshold : price <= threshold;
}

// Re-arm when the price moves back across the threshold by at least
// HYSTERESIS_PCT of the threshold value. Prevents a single oscillation around
// the threshold from re-firing every minute.
export function rearms(op: AlertOp, price: number, threshold: number): boolean {
  const band = Math.abs(threshold) * HYSTERESIS_PCT;
  return op === "GTE" ? price < threshold - band : price > threshold + band;
}

function formatAlertText(
  symbol: string,
  op: AlertOp,
  threshold: number,
  price: number,
): string {
  const dir = op === "GTE" ? "≥" : "≤";
  const fmt = (n: number) => (n >= 1 ? n.toFixed(2) : n.toPrecision(4));
  return `🔔 ${symbol.toUpperCase()} ${dir} $${fmt(threshold)} — now $${fmt(price)}`;
}

export async function runAlertsEval(deps: Deps): Promise<EvalSummary> {
  const { prisma, redis, notify = notifyUser } = deps;

  const alerts = await prisma.priceAlert.findMany({
    where: { enabled: true },
    select: {
      id: true, userId: true, coinId: true, symbol: true,
      op: true, threshold: true, triggered: true,
    },
  });

  // Group by coinId to minimise Redis reads.
  const byCoin = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const list = byCoin.get(a.coinId) ?? [];
    list.push(a);
    byCoin.set(a.coinId, list);
  }

  let fired = 0, rearmed = 0, skipped = 0;
  for (const [coinId, group] of byCoin) {
    const price = await readPrice(redis, prisma as PrismaClient, coinId);
    if (price === null) {
      skipped += group.length;
      continue;
    }
    for (const a of group) {
      const isFiring = fires(a.op, price, a.threshold);
      if (!a.triggered && isFiring) {
        await prisma.priceAlert.update({
          where: { id: a.id },
          data: { triggered: true, lastFiredAt: new Date() },
        });
        await notify({
          userId: a.userId,
          text: formatAlertText(a.symbol, a.op, a.threshold, price),
          subject: `Trientes alert: ${a.symbol.toUpperCase()} ${a.op === "GTE" ? "≥" : "≤"} $${a.threshold}`,
        });
        fired++;
      } else if (a.triggered && rearms(a.op, price, a.threshold)) {
        await prisma.priceAlert.update({
          where: { id: a.id },
          data: { triggered: false },
        });
        rearmed++;
      } else {
        skipped++;
      }
    }
  }

  return { scanned: alerts.length, fired, rearmed, skipped };
}
