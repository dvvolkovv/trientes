import { config } from "dotenv";
config({ path: ".env.local" });

import cron from "node-cron";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { fetchTop100L1, fetchGlobalSnap, fetchExchangeRates, fetchCoinDetail, fetchExchanges, fetchMarketsByIds } from "../src/lib/coingecko";
import { fetchNews } from "../src/lib/news";
import { fetchFearGreed } from "../src/lib/fear-greed";
import { fetchMarkets } from "../src/lib/markets";
import { syncPrices, syncGlobal, syncExchangeRates, syncCoinMetadata, syncExchanges, syncAdminAddedPrices, syncNews, syncFearGreed, syncMarkets, syncCoinPaprikaExchanges } from "../src/lib/sync/orchestrator";
import { fetchCoinPaprikaExchanges, fetchCoinPaprikaExchangeDetail } from "../src/lib/coinpaprika";
import { runAlertsEval } from "../src/lib/alerts-eval";
import { syncOsmCryptoPois } from "../src/lib/osm-poi-store";
import { expireStaleRevisions } from "../src/lib/coin-card-expiry";
import { expireStaleDeletionRequests } from "../src/lib/company-deletion-expiry";
import { warmProseTranslations } from "../src/lib/prose-warmup";
import { verifyCardContracts } from "../src/lib/coin-card-onchain";
import { pruneCardPricePoints, syncCardMarkets } from "../src/lib/coin-card-markets";
import { expireStaleClaims } from "../src/lib/coin-card-claim";
import { syncCardSupply } from "../src/lib/coin-card-supply";
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
    if (count === 0) {
      // Upstream refused us — the previous snapshot is kept, but this must not read as "ok".
      console.error(`[worker] markets-sync empty: upstream returned no quotes in ${Date.now() - t0}ms`);
      return;
    }
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

async function runCoinPaprikaSync() {
  const t0 = Date.now();
  try {
    // Read BTC/USD from the latest CoinSnapshot. Falls back to 0 (skip volume24hBtc) if absent.
    // No price:bitcoin:usd Redis key exists in this codebase, so we use Prisma directly.
    const btcRow = await prisma.coinSnapshot.findFirst({
      where: { coinId: "bitcoin" },
      orderBy: { fetchedAt: "desc" },
      select: { priceUsd: true },
    });
    const btcUsd = btcRow?.priceUsd ? Number(btcRow.priceUsd) : 0;
    const result = await syncCoinPaprikaExchanges({
      fetchAll: fetchCoinPaprikaExchanges,
      fetchDetail: fetchCoinPaprikaExchangeDetail,
      prisma: prisma as never,
      minVolumeUsd: 100_000,
      btcUsd,
      detailCallBudget: 25,
    });
    console.log(`[worker] coinpaprika-sync ok: +${result.created} new, ~${result.enriched} enriched, ${result.skipped} skipped, ${result.detailsAttempted} details, ${result.marketsUpserted} markets in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] coinpaprika-sync failed:`, err);
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

let alertsEvalRunning = false;
async function runAlerts() {
  if (alertsEvalRunning) return; // prior tick still running; skip silently
  alertsEvalRunning = true;
  const t0 = Date.now();
  try {
    const s = await runAlertsEval({ prisma: prisma as never, redis: redis as never });
    if (s.fired > 0 || s.rearmed > 0) {
      console.log(`[worker] alerts-eval ok: scanned=${s.scanned} fired=${s.fired} rearmed=${s.rearmed} skipped=${s.skipped} in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[worker] alerts-eval failed:", err);
  } finally {
    alertsEvalRunning = false;
  }
}

async function runOsmPoiSync() {
  const t0 = Date.now();
  try {
    const s = await syncOsmCryptoPois();
    console.log(
      `[worker] osm-poi sync ok (${s.incremental ? "incremental" : "full"}): upserted=${s.upserted} deleted=${s.deleted} in ${Date.now() - t0}ms`,
    );
  } catch (err) {
    console.error("[worker] osm-poi sync failed:", err);
  }
}

async function runRevisionExpiry() {
  const t0 = Date.now();
  try {
    const count = await expireStaleRevisions(prisma);
    if (count > 0) {
      console.log(`[worker] coin revision expiry ok: ${count} expired in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[worker] coin revision expiry failed:", err);
  }
}

async function runDeletionRequestExpiry() {
  const t0 = Date.now();
  try {
    const count = await expireStaleDeletionRequests(prisma);
    if (count > 0) {
      console.log(`[worker] deletion request expiry ok: ${count} expired in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[worker] deletion request expiry failed:", err);
  }
}

async function runProseWarmup() {
  const t0 = Date.now();
  try {
    const count = await warmProseTranslations(prisma);
    if (count > 0) {
      console.log(`[worker] prose warmup ok: ${count} translations in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[worker] prose warmup failed:", err);
  }
}

/**
 * Слайс B: сверка заявленных контрактов с сетью. Раз в сутки и не больше 50
 * контрактов за прогон — очередь идёт от самых давно не проверенных, а
 * публичные RPC не для обстрела.
 */
async function runContractVerify() {
  const t0 = Date.now();
  try {
    const s = await verifyCardContracts({ prisma: prisma as never, limit: 50 });
    if (s.checked > 0) {
      console.log(
        `[worker] contract verify ok: ${s.checked} checked, ${s.verified} verified, ` +
          `${s.mismatched} mismatched, ${s.failed} failed in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] contract verify failed:", err);
  }
}

/**
 * Слайс C: собственный ценовой индекс. Запросов за прогон — по числу бирж
 * (снимок всех тикеров одним запросом, с кешем в Redis), а не по числу рынков.
 */
async function runCardMarketSync() {
  const t0 = Date.now();
  try {
    const s = await syncCardMarkets({ prisma: prisma as never, redis: redis as never });
    if (s.cards > 0) {
      console.log(
        `[worker] card-market sync ok: ${s.cards} cards, ${s.marketsChecked} markets ` +
          `(${s.confirmed} confirmed, ${s.failed} failed), ${s.indexed} indexed in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] card-market sync failed:", err);
  }
}

/**
 * Слайс E: проверенный циркулирующий выпуск. Раз в час и не больше 50 карточек
 * за прогон: на карточку уходит до 21 вызова `eth_call` (общий выпуск плюс
 * двадцать адресов исключений), а выпуск меняется редко.
 */
async function runSupplySweep() {
  const t0 = Date.now();
  try {
    const s = await syncCardSupply({ prisma: prisma as never, limit: 50 });
    if (s.cards > 0) {
      console.log(
        `[worker] supply sweep ok: ${s.cards} cards (${s.ok} ok, ${s.partial} partial, ` +
          `${s.failed} failed) in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] supply sweep failed:", err);
  }
}

/**
 * Слайс D: просроченные заявки на владение. Автопроверки доказательств нет
 * сознательно — запись в DNS и файл появляются по действию человека, и он же
 * нажимает «Проверить»; воркеру остаётся только гасить просроченные вызовы.
 */
async function runClaimSweep() {
  const t0 = Date.now();
  try {
    const count = await expireStaleClaims({ prisma: prisma as never });
    if (count > 0) console.log(`[worker] claim sweep ok: ${count} expired in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] claim sweep failed:", err);
  }
}

async function runCleanup() {
  const t0 = Date.now();
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [snaps, views] = await Promise.all([
      prisma.coinSnapshot.deleteMany({ where: { fetchedAt: { lt: thirtyDaysAgo } } }),
      prisma.pageView.deleteMany({ where: { createdAt: { lt: ninetyDaysAgo } } }),
    ]);
    const points = await pruneCardPricePoints({ prisma: prisma as never });
    console.log(`[worker] cleanup ok: deleted ${snaps.count} snapshots + ${views.count} page views + ${points} price points in ${Date.now() - t0}ms`);
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
  void runCoinPaprikaSync();
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

  // CoinPaprika exchanges — hourly enrichment + new-exchange discovery; offset to :25/:55.
  cron.schedule("25,55 * * * *", () => {
    void runCoinPaprikaSync();
  });

  // Daily kick; staleMs in syncCoinMetadata skips coins fetched within 7 days.
  cron.schedule("30 3 * * *", () => void runMetadataSync());

  // Crypto POIs from BTC Map — nightly at 02:40, ahead of the other daily jobs.
  // After the first full pull each run is incremental (a few dozen changed places).
  cron.schedule("40 2 * * *", () => void runOsmPoiSync());

  // Price alerts — every minute. Reads cached prices, no upstream API calls.
  cron.schedule("* * * * *", () => void runAlerts());

  // Daily at 04:00 server time — runs after metadata-sync (03:30) so we don't
  // race with that job's read of latest snapshots.
  cron.schedule("50 * * * *", () => void runRevisionExpiry());
  cron.schedule("55 * * * *", () => void runDeletionRequestExpiry());
  // Прогрев переводов: дважды в сутки, чтобы правка карточки доехала до всех
  // локалей раньше, чем в неё зайдёт первый посетитель или робот.
  cron.schedule("25 3,15 * * *", () => void runProseWarmup());
  cron.schedule("10 5 * * *", () => void runContractVerify());
  cron.schedule("*/10 * * * *", () => void runCardMarketSync());
  cron.schedule("20 * * * *", () => void runClaimSweep());
  cron.schedule("45 * * * *", () => void runSupplySweep());
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
