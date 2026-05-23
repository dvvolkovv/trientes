import { config } from "dotenv";
config({ path: ".env.local" });

import cron from "node-cron";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { fetchTop100L1, fetchGlobalSnap, fetchExchangeRates, fetchCoinDetail, fetchExchanges, fetchMarketsByIds } from "../src/lib/coingecko";
import { fetchNews } from "../src/lib/news";
import { fetchFearGreed } from "../src/lib/fear-greed";
import { fetchMarkets } from "../src/lib/markets";
import { syncPrices, syncGlobal, syncExchangeRates, syncCoinMetadata, syncExchanges, syncAdminAddedPrices, syncNews, syncFearGreed, syncMarkets } from "../src/lib/sync/orchestrator";
import { startBinance, stopBinance } from "./binance";

async function runPriceSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncPrices({
      fetchTop100L1,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] price-sync ok: ${count} coins in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] price-sync failed:`, err);
  }
}

async function runGlobalSync() {
  const t0 = Date.now();
  try {
    await syncGlobal({
      fetchGlobalSnap,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] global-sync ok in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] global-sync failed:`, err);
  }
}

async function runRatesSync() {
  const t0 = Date.now();
  try {
    await syncExchangeRates({ fetchExchangeRates, redis: redis as never });
    console.log(`[worker] rates-sync ok in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] rates-sync failed:`, err);
  }
}

async function runNewsSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncNews({ fetchNews, redis: redis as never });
    console.log(`[worker] news-sync ok: ${count} items in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] news-sync failed:`, err);
  }
}

async function runFearGreedSync() {
  const t0 = Date.now();
  try {
    const { value } = await syncFearGreed({ fetchFearGreed, redis: redis as never });
    console.log(`[worker] fear-greed-sync ok: ${value} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] fear-greed-sync failed:`, err);
  }
}

async function runMarketsSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncMarkets({ fetchMarkets, redis: redis as never });
    console.log(`[worker] markets-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] markets-sync failed:`, err);
  }
}

let metadataSyncRunning = false;
async function runMetadataSync() {
  if (metadataSyncRunning) {
    console.log("[worker] metadata-sync: already running, skipping tick");
    return;
  }
  metadataSyncRunning = true;
  const t0 = Date.now();
  try {
    const { updated, skipped, failed } = await syncCoinMetadata({
      fetchCoinDetail,
      prisma: prisma as never,
    });
    console.log(`[worker] metadata-sync done in ${((Date.now() - t0) / 1000).toFixed(1)}s — updated=${updated} skipped=${skipped} failed=${failed}`);
  } catch (err) {
    console.error("[worker] metadata-sync fatal:", err);
  } finally {
    metadataSyncRunning = false;
  }
}

async function runExchangesSync() {
  const t0 = Date.now();
  try {
    // Need BTC/USD to compute USD volumes. Read rates cache.
    const ratesRaw = await redis.get("exchange:rates");
    if (!ratesRaw) {
      console.warn("[worker] exchanges-sync: rates cache empty, skipping tick");
      return;
    }
    const rates = JSON.parse(ratesRaw) as Record<string, { value: number }>;
    const btcUsd = rates.usd?.value;
    if (!btcUsd) {
      console.warn("[worker] exchanges-sync: usd rate missing");
      return;
    }
    const { count } = await syncExchanges({
      fetchExchanges,
      btcUsd,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] exchanges-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] exchanges-sync failed:", err);
  }
}

async function runAdminAddedSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncAdminAddedPrices({
      listAdminAddedIds: async () => {
        const rows = await prisma.coin.findMany({
          where: { source: "ADMIN_ADDED", isActive: true },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      },
      fetchByIds: fetchMarketsByIds,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] admin-added-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] admin-added-sync failed:", err);
  }
}

async function runCleanup() {
  const t0 = Date.now();
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.coinSnapshot.deleteMany({
      where: { fetchedAt: { lt: thirtyDaysAgo } },
    });
    console.log(`[worker] cleanup ok: deleted ${result.count} snapshots in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] cleanup failed:", err);
  }
}

async function main() {
  console.log("[worker] starting…");
  await prisma.$queryRaw`SELECT 1`;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  await redis.ping();
  console.log("[worker] connections ok.");

  // Run once at startup so Redis has data immediately.
  await runPriceSync();
  await runGlobalSync();
  await runRatesSync();
  await runExchangesSync();
  await runAdminAddedSync();
  await runNewsSync();
  await runFearGreedSync();
  await runMarketsSync();

  // Kick metadata-sync in the background — don't block startup on a ~3 min loop.
  void runMetadataSync();

  // Cadences sized for CoinGecko Free tier (10k calls/month).
  // 10 min × 144/day + 30 min × 48/day × 2 = ~240 scheduled calls/day ≈ 7.2k/month.
  // Stagger the 30-min batch off the 10-min boundary so we don't fire 5 CoinGecko
  // calls in the same second at :00 / :30 (caused sporadic 429s).
  cron.schedule("*/10 * * * *", () => void runPriceSync());
  cron.schedule("5,35 * * * *", () => {
    void runGlobalSync();
    void runRatesSync();
    void runExchangesSync();
    void runAdminAddedSync();
  });
  // News + Fear & Greed — both public, no-key, independent of CoinGecko, so staggered to :15/:45.
  cron.schedule("15,45 * * * *", () => {
    void runNewsSync();
    void runFearGreedSync();
  });

  // Markets (Stooq) — key-less, independent of CoinGecko; every 20 min, offset off the others.
  cron.schedule("8,28,48 * * * *", () => void runMarketsSync());

  // Daily kick; staleMs in syncCoinMetadata skips coins fetched within 7 days.
  cron.schedule("30 3 * * *", () => void runMetadataSync());

  // Daily at 04:00 server time — runs after metadata-sync (03:30) so we don't
  // race with that job's read of latest snapshots.
  cron.schedule("0 4 * * *", () => void runCleanup());

  // Live price feed via Binance WebSocket — top 20 coins.
  startBinance();

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
    stopBinance();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
