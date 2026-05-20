import { config } from "dotenv";
config({ path: ".env.local" });

import cron from "node-cron";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { fetchTop100L1, fetchGlobalSnap, fetchExchangeRates } from "../src/lib/coingecko";
import { syncPrices, syncGlobal, syncExchangeRates } from "../src/lib/sync/orchestrator";

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

  // 60s for prices, 5 min for global stats + rates.
  cron.schedule("*/60 * * * * *", () => void runPriceSync());
  cron.schedule("*/5 * * * *", () => {
    void runGlobalSync();
    void runRatesSync();
  });

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
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
