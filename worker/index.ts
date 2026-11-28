import { config } from "dotenv";
config({ path: ".env.local" });

import cron from "node-cron";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { fetchTop100L1, fetchGlobalSnap, fetchExchangeRates, fetchCoinDetail, fetchExchanges, fetchMarketsByIds } from "../src/lib/coingecko";
import { fetchNews } from "../src/lib/news";
import { fetchFearGreed } from "../src/lib/fear-greed";
import { fetchMarkets } from "../src/lib/markets";
import { syncPrices, syncGlobal, syncExchangeRates, syncCoinMetadata, syncExchanges, syncAdminAddedPrices, syncCardedCoinPrices, staleCardedIds, syncNews, syncFearGreed, syncMarkets, syncCoinPaprikaExchanges, syncCoinloreExchanges } from "../src/lib/sync/orchestrator";
import { fetchCoinPaprikaExchanges, fetchCoinPaprikaExchangeDetail } from "../src/lib/coinpaprika";
import { fetchCoinloreExchanges, fetchCoinlorePairs } from "../src/lib/coinlore";
import { CpHttpError, CpQuotaBlockedError } from "../src/lib/coinpaprika-http";
import { RUN_COINPAPRIKA, RUN_COINLORE, recordRun } from "../src/lib/sync/run-state";
import { installQuotaCounter } from "../src/lib/quota/install";
import { planRun } from "../src/lib/quota/plan";
import { QUOTA_SERVICES } from "../src/lib/quota/budget";
import { runAlertsEval } from "../src/lib/alerts-eval";
import { syncOsmCryptoPois } from "../src/lib/osm-poi-store";
import { expireStaleRevisions } from "../src/lib/coin-card-expiry";
import { expireStaleDeletionRequests } from "../src/lib/company-deletion-expiry";
import { warmProseTranslations } from "../src/lib/prose-warmup";
import { verifyCardContracts } from "../src/lib/coin-card-onchain";
import {
  computeAnchorPrices,
  pruneCardPricePoints,
  syncCardMarkets,
} from "../src/lib/coin-card-markets";
import { ALL_CEX_IDS, getSnapshots } from "../src/lib/cex-snapshot";
import { seedCardMarkets } from "../src/lib/coin-card-market-seed";
import { fetchLlamaPrices } from "../src/lib/defillama";
import { syncOwnDexMarkets } from "../src/lib/coin-card-dex-market";
import { expireStaleClaims } from "../src/lib/coin-card-claim";
import { syncChainFacts } from "../src/lib/coin-card-chain-facts";
import { syncCardSupply } from "../src/lib/coin-card-supply";
import { runListingSweep } from "../src/lib/coin-card-listing-sweep";
import { sendHealthReport } from "../src/lib/health-report";
import { runCaseDueSweep } from "../src/lib/cases/due-sweep";
import { runClaimMailboxSweep } from "../src/lib/claims/sweep";
import { runPointReportSweep } from "../src/lib/points/report-sweep";
import { runPayLinkDueSweep, runPayLinkSweep } from "../src/lib/pay-link/sweep";
import { runCompanyReviewSweep } from "../src/lib/cases/company-review-sweep";
import { runReorderSweep } from "../src/lib/supply/reorder-sweep";
import { runStaffAccessReviewSweep } from "../src/lib/staff-access-sweep";
import { runWebhookSweep } from "../src/lib/automation/deliver";
import { startBinance, stopBinance } from "./binance";
import { syncSanctions } from "../src/lib/sanctions/ofac";

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
    const { updated, skipped, failed, retired } = await syncCoinMetadata({
      fetchCoinDetail,
      prisma: prisma as never,
      // Нужна только при 404: монету скрываем лишь тогда, когда ей и цены никто
      // не пишет. Один запрос на такой случай, а не на каждую монету обхода.
      lastPricedAt: async (id) => {
        const row = await prisma.coinSnapshot.findFirst({
          where: { coinId: id },
          orderBy: { fetchedAt: "desc" },
          select: { fetchedAt: true },
        });
        return row?.fetchedAt ?? null;
      },
    });
    console.log(`[worker] metadata-sync done in ${((Date.now() - t0) / 1000).toFixed(1)}s — updated=${updated} skipped=${skipped} failed=${failed} retired=${retired}`);
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
    // Сколько подробностей можно сегодня — считает бюджет, а не константа.
    // Пришпиленное число (было 10) одинаково в первый день месяца и в
    // последний, и ничего не знает о том, сколько в этом месяце прочитали живые
    // страницы: 19 ноября запас кончился на середине месяца именно так.
    const plan = await planRun(redis, QUOTA_SERVICES.coinpaprika, {
      runsPerDay: 24,
      fixedCostPerRun: 1, // запрос списка бирж уходит всегда
      perRunCap: 25,
    });
    if (!plan.allowed) {
      console.log(`[worker] coinpaprika-sync skipped by budget: ${plan.reason}`);
      return;
    }
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
      // Бюджет считается из остатка месяца, брони живым страницам и числа
      // прогонов до конца суток (`src/lib/quota/budget.ts`).
      detailCallBudget: plan.calls,
    });
    // Свой след прогона: строки `Exchange` трогает и прогон CoinGecko, поэтому
    // по базе молчание CoinPaprika не видно, и ночной отчёт пять дней его не
    // замечал (уборка BH). Список прошёл, а подробности отказали по запасу —
    // это не удачный прогон: `pairsCount` и рынки не обновятся ни у кого.
    await recordRun(redis, RUN_COINPAPRIKA, result.quotaExhausted ? "quota" : "ok", new Date());
    console.log(`[worker] coinpaprika-sync ${result.quotaExhausted ? "partial (quota exhausted on details)" : "ok"}: +${result.created} new, ~${result.enriched} enriched, ${result.skipped} skipped, ${result.detailsOk}/${result.detailsAttempted} details (budget ${plan.calls}), ${result.marketsUpserted} markets in ${Date.now() - t0}ms`);
  } catch (err) {
    // Исчерпанный запас месяца — состояние службы, а не сбой прогона: звонить
    // некуда до обновления запаса, и строка об этом не должна выглядеть аварией.
    // Исчерпанный запас — состояние службы, а не сбой прогона: отчёт назовёт
    // его причиной тишины, а не замолчавшим прогоном.
    if (err instanceof CpQuotaBlockedError || (err instanceof CpHttpError && err.quotaExhausted)) {
      await recordRun(redis, RUN_COINPAPRIKA, "quota", new Date());
      console.log(`[worker] coinpaprika-sync skipped: ${err.message}`);
      return;
    }
    console.error(`[worker] coinpaprika-sync failed:`, err);
  }
}

/**
 * Пары бирж от Coinlore — раз в сутки. Служба бесплатна и месячного запаса не
 * имеет, поэтому предел здесь наш собственный (защита от разгона), а не её.
 */
async function runCoinloreSync() {
  const t0 = Date.now();
  try {
    const plan = await planRun(redis, QUOTA_SERVICES.coinlore, {
      runsPerDay: 1,
      fixedCostPerRun: 1, // запрос списка бирж
      perRunCap: 200,
    });
    if (!plan.allowed) {
      console.log(`[worker] coinlore-sync skipped by budget: ${plan.reason}`);
      return;
    }
    const r = await syncCoinloreExchanges({
      fetchExchanges: () => fetchCoinloreExchanges(),
      fetchPairs: (id) => fetchCoinlorePairs(id),
      prisma: prisma as never,
      pairBudget: plan.calls,
      now: new Date(),
    });
    await recordRun(redis, RUN_COINLORE, "ok", new Date());
    console.log(
      `[worker] coinlore-sync ok: ${r.matched} matched, ${r.unmatched} unmatched, ${r.marketsUpserted} markets, ` +
        `${r.pairsStale} stale pairs, ${r.pairFailures} pair failures, ${r.pairsSkippedByBudget} skipped by budget ` +
        `(budget ${plan.calls}) in ${Date.now() - t0}ms`,
    );
  } catch (err) {
    console.error("[worker] coinlore-sync failed:", err);
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

/**
 * Цена монетам с опубликованной карточкой, которых не приносит ни список
 * top-100 L1, ни выборка заведённых руками (разбор — в `syncCardedCoinPrices`).
 * Раз в час: опора посева рынков считается годной двое суток, чаще незачем.
 */
async function runCardedCoinPriceSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncCardedCoinPrices({
      listStaleCardedIds: async () => {
        const cards = await prisma.coinCard.findMany({
          where: { status: "APPROVED" },
          select: {
            coin: {
              select: {
                id: true,
                isActive: true,
                snapshots: { select: { fetchedAt: true }, orderBy: { fetchedAt: "desc" }, take: 1 },
              },
            },
          },
        });
        const rows = cards
          .map((c) => c.coin)
          .filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.isActive)
          .map((c) => ({ coinId: c.id, lastSnapshotAt: c.snapshots[0]?.fetchedAt ?? null }));
        return staleCardedIds(rows, new Date());
      },
      fetchByIds: fetchMarketsByIds,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] carded-coin-price-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] carded-coin-price-sync failed:", err);
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

async function runStaffAccessReviewJob() {
  const t0 = Date.now();
  try {
    const stats = await runStaffAccessReviewSweep();
    if (stats.due || stats.noOwner) {
      console.log(
        `[worker] staff access review ok: ${stats.due} due, ${stats.notified} notified, ${stats.noOwner} without an owner to ring, ${stats.checked} checked in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] staff access review sweep failed:", err);
  }
}

async function runCompanyReviewJob() {
  const t0 = Date.now();
  try {
    const stats = await runCompanyReviewSweep();
    if (stats.opened || stats.backfilled || stats.rang || stats.reopened || stats.noAddressee) {
      console.log(
        `[worker] company review ok: ${stats.rang} rang, ${stats.reopened} reopened, ${stats.opened} cases opened, ${stats.backfilled} dates backfilled, ${stats.noAddressee} without addressee, ${stats.checked} checked in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] company review sweep failed:", err);
  }
}

async function runPointReportJob() {
  const t0 = Date.now();
  try {
    const stats = await runPointReportSweep();
    if (stats.reviewed || stats.warned || stats.suspended) {
      console.log(
        `[worker] point reports ok: ${stats.reviewed} under review, ${stats.warned} warned, ${stats.suspended} suspended, ${stats.checked} checked in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] point report sweep failed:", err);
  }
}

async function runReorderJob() {
  const t0 = Date.now();
  try {
    const stats = await runReorderSweep();
    if (stats.drafts) {
      console.log(
        `[worker] reorder ok: ${stats.drafts} drafts, ${stats.lines} lines, ${stats.rules} rules, ${stats.skippedOpenOrder} skipped (open order) in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] reorder sweep failed:", err);
  }
}

/**
 * Доставка исходящих оповещений (слайс CO). Каждые две минуты: оповещение, пришедшее
 * через час, оповещением уже не является, а вебсокетов и очереди в проекте нет.
 *
 * Молчит, когда нечего делать и нечего сказать: отчёт на двадцать одинаковых строк
 * перестают читать (правило AA).
 */
async function runWebhookJob() {
  const t0 = Date.now();
  try {
    const stats = await runWebhookSweep();
    if (stats.reason === "no_secret_key") return;
    if (stats.taken > 0 || stats.prunedEvents > 0) {
      console.log(
        `[worker] webhooks ok: ${stats.delivered} delivered, ${stats.retried} retry, ${stats.dropped} dropped, ${stats.skipped} skipped, pruned ${stats.prunedEvents} events / ${stats.prunedDeliveries} deliveries in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] webhook sweep failed:", err);
  }
}

async function runCaseDueJob() {
  const t0 = Date.now();
  try {
    const stats = await runCaseDueSweep(prisma);
    if (stats.raised > 0) {
      console.log(
        `[worker] case due sweep ok: ${stats.raised} raised, ${stats.skipped} already known, ${stats.checked} checked in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] case due sweep failed:", err);
  }
}

/**
 * Санкционный список OFAC (слайс CR, ТЗ 6.8). Раз в сутки: список публикуется по
 * рабочим дням, и чаще спрашивать тридцать мегабайт незачем. Пустой разбор прежний
 * список **не затирает** — ноль адресов означает смену формата, а не отмену санкций.
 */
async function runSanctionsJob() {
  const t0 = Date.now();
  try {
    const res = await syncSanctions();
    if (res.ok) {
      console.log(
        `[worker] sanctions ok: ${res.written} addresses, published ${res.publishedAt?.toISOString().slice(0, 10) ?? "?"} in ${Date.now() - t0}ms`,
      );
    } else {
      console.error(`[worker] sanctions failed: ${res.reason}${res.detail ? ` (${res.detail})` : ""}`);
    }
  } catch (err) {
    console.error("[worker] sanctions sync failed:", err);
  }
}

/**
 * Суточная проверка ссылок оплаты (слайс CP, § 2.9). Молчание службы прежние числа не
 * стирает — отчёт печатается только когда что-то изменилось (правило AA).
 */
async function runPayLinkJob() {
  const t0 = Date.now();
  try {
    const stats = await runPayLinkSweep();
    if (stats.hidden || stats.disabled || stats.mismatched || stats.later) {
      console.log(
        `[worker] pay links ok: ${stats.ok} live, ${stats.disabled} disabled, ${stats.hidden} hidden, ${stats.mismatched} mismatched, ${stats.later} unreachable of ${stats.checked} in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] pay link sweep failed:", err);
  }
}

/**
 * Исполнение отложенных смен ссылки. Каждые десять минут: срок считается сутками, и
 * часовой прогон растянул бы «через 24 часа» до двадцати пяти.
 */
async function runPayLinkDueJob() {
  const t0 = Date.now();
  try {
    const stats = await runPayLinkDueSweep();
    if (stats.due > 0) {
      console.log(
        `[worker] pay link changes: ${stats.applied} applied, ${stats.cancelled} cancelled, ${stats.waiting} waiting of ${stats.due} due in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] pay link due sweep failed:", err);
  }
}

async function runClaimMailboxJob() {
  const t0 = Date.now();
  try {
    const stats = await runClaimMailboxSweep();
    // Нет ключей ящика — молчим: это не сбой, а выключенная дверь. Иначе лог
    // наполнялся бы одной строкой каждые пять минут.
    if (stats.error === "mailbox_not_configured") return;
    if (stats.error) {
      console.error(`[worker] claim mailbox sweep failed: ${stats.error}`);
      return;
    }
    if (stats.read > 0) {
      console.log(
        `[worker] claim mailbox ok: ${stats.read} read, ${stats.claimed} claimed, ${stats.appended} appended, skipped ${JSON.stringify(stats.skipped)} in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] claim mailbox sweep failed:", err);
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
 * Слайс E: проверенный циркулирующий выпуск. Раз в час и не больше 100 карточек
 * за прогон: на карточку уходит до 21 вызова `eth_call` (общий выпуск плюс
 * двадцать адресов исключений), а выпуск меняется редко.
 */
async function runChainFactsSweep() {
  const t0 = Date.now();
  try {
    const s = await syncChainFacts({ prisma: prisma as never, limit: 100 });
    if (s.cards > 0) {
      console.log(
        `[worker] chain facts ok: ${s.cards} cards (${s.ok} ok, ${s.failed} failed) ` +
          `in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] chain facts failed:", err);
  }
}

async function runSupplySweep() {
  const t0 = Date.now();
  try {
    const s = await syncCardSupply({ prisma: prisma as never, limit: 100 });
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
 * Слайс W: конвейер листинга. Раз в сутки заводит монету и карточку для новых
 * строк реестра и открывает те карточки, где сеть подтвердила всё и не один
 * раз. Прогон идёт после ночных чтений фактов и выпуска, чтобы решение
 * принималось по свежим строкам.
 */
/**
 * Отчёт здоровья владельцу в Telegram: замолчавшие прогоны, ошибки чтения сетей,
 * доли ответов nginx за сутки, живой GET трёх страниц. Поломку стакана на
 * /exchange (12 часов ответов 429) нашли руками по логам — это чтобы следующую
 * нашли сами.
 */
async function runHealthReportJob() {
  const t0 = Date.now();
  try {
    const r = await sendHealthReport({ prisma: prisma as never, redis: redis as never });
    console.log(`[worker] health report sent to ${r.sent.length} chat(s)${r.failed.length ? `, failed: ${r.failed.map((f) => `${f.chatId} (${f.reason})`).join(", ")}` : ""} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] health report failed:", err);
  }
}

async function runListingSweepJob() {
  const t0 = Date.now();
  try {
    const s = await runListingSweep({ prisma: prisma as never });
    const held = Object.entries(s.held)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    if (s.coinsCreated || s.cardsCreated || s.published || held) {
      console.log(
        `[worker] listing sweep ok: +${s.coinsCreated} coins, +${s.cardsCreated} cards, ` +
          `${s.published} published${held ? `, held: ${held}` : ""} in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] listing sweep failed:", err);
  }
}

/**
 * Слайс X: посев рынков карточкам, проверенным в сети. У такой карточки нет
 * проекта, который заявил бы листинг, поэтому рынок заявляем мы — найденный в
 * снимках бирж и сверенный с опорной ценой, чтобы тикер-двойник не принёс на
 * карточку цену чужого актива. Сразу после посева зовётся сверка слайса C:
 * иначе новый рынок простоит без цены до следующего десятиминутного прогона.
 */
/**
 * Рынок нашего собственного обмена. Чаще раза в час незачем: цену пишет не
 * биржевой снимок, а сеть, и она отвечает на каждый запрос заново — а индекс
 * всё равно пересчитывается прогоном `runCardMarketSync` каждые десять минут.
 */
async function runOwnDexMarketJob() {
  const t0 = Date.now();
  try {
    const stats = await syncOwnDexMarkets({ prisma: prisma as never });
    if (stats.written > 0 || stats.failed > 0) {
      console.log(
        `[worker] own-dex markets ok: ${stats.written} written, ${stats.failed} failed ` +
          `${JSON.stringify(stats.errors)} in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] own-dex markets failed:", err);
  }
}

async function runCardMarketSeedJob() {
  const t0 = Date.now();
  try {
    const snapshots = await getSnapshots(ALL_CEX_IDS, { redis: redis as never });
    const anchors = computeAnchorPrices(snapshots);
    const { stats } = await seedCardMarkets({
      prisma: prisma as never,
      snapshots,
      anchors,
      // Запасная опора у карточек без своего снимка цены — даром, одним
      // запросом на прогон (слайс BL): прежде за неё платили вызовом к
      // CoinGecko, то есть запасом главной страницы.
      fetchFallbackPrices: (ids) => fetchLlamaPrices(ids),
    });
    if (stats.cards > 0) {
      console.log(
        `[worker] card-market seed ok: ${stats.cards} cards, +${stats.created} markets ` +
          `(${stats.noReference} no reference, ${stats.fallbackReference} by fallback, ${stats.noPairs} no pairs, ` +
          `${stats.conflict} price conflict, ${stats.rejected} rejected) ` +
          `in ${Date.now() - t0}ms`,
      );
    }
    if (stats.created > 0) await runCardMarketSync();
  } catch (err) {
    console.error("[worker] card-market seed failed:", err);
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

  // Счёт вызовов чужих служб — до первого прогона: вызов, сделанный раньше
  // установки счётчика, в расход не попадёт, и бюджет весь месяц будет считаться
  // от заниженного числа.
  installQuotaCounter();

  // Run once at startup so Redis has data immediately.
  await runPriceSync();
  await runGlobalSync();
  await runRatesSync();
  await runExchangesSync();
  // CoinPaprika при старте **не зовём**: её ответы ложатся в базу, а не в Redis,
  // греть нечего. А воркер перезапускается по нескольку раз в день (19 ноября —
  // четырнадцать), и каждый такой прогон съедал 26 запросов из месячного запаса
  // в 20 000. Каталог бирж наполняет часовой прогон ниже.
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
  // Четыре прогона CoinGecko — **по очереди**, а не залпом. Параллельный `void`
  // отправлял четыре запроса в одну секунду, бесплатный тариф отвечал 429 всем
  // четырём, и повторы уходили синхронно: в логах 02:35:15 и 03:35:15 — четыре
  // падения с одной отметкой времени. Промежуток между запросами держит шлюз
  // `coingecko-http`, но очередь здесь нужна всё равно: иначе порядок прогонов
  // решает случай, а ошибка одного тянет за собой ожидание остальных.
  cron.schedule("5,35 * * * *", () => {
    void (async () => {
      await runGlobalSync();
      await runRatesSync();
      await runExchangesSync();
      await runAdminAddedSync();
    })();
  });
  // News + Fear & Greed — both public, no-key, independent of CoinGecko, so staggered to :15/:45.
  cron.schedule("15,45 * * * *", () => {
    void runNewsSync();
    void runFearGreedSync();
  });

  // Markets (Stooq) — key-less, independent of CoinGecko; every 20 min, offset off the others.
  cron.schedule("8,28,48 * * * *", () => void runMarketsSync());

  // CoinPaprika exchanges — обогащение каталога и поиск новых бирж.
  //
  // Расписание — раз в час, а **размер прогона считает бюджет** (слайс BL,
  // `src/lib/quota/budget.ts`): остаток месячного запаса минус броня живым
  // страницам, делённый на сутки до конца месяца и на прогоны до конца суток.
  // Прежние два прогона в час по 26 запросов — это 37 тысяч в месяц против
  // запаса 20 000, и 19 ноября он кончился на середине месяца: служба начала
  // отвечать 402 на всё, страница биржи стала отдаваться 50 секунд, веб падал
  // по памяти. Пришпиленные 10 подробностей это починили, но вслепую: число не
  // знало ни про остаток, ни про чтения страниц. Теперь знает.
  cron.schedule("25 * * * *", () => {
    void runCoinPaprikaSync();
  });

  // Пары бирж от Coinlore — в 02:15, перед синком BTC Map (02:40) и вдали от
  // часового обхода CoinPaprika (:25). Служба бесплатна, но ходить к ней чаще
  // незачем: число пар и состав пар меняются медленнее суток.
  cron.schedule("15 2 * * *", () => void runCoinloreSync());

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
  // Сроки дел — раз в час. Просрочка не событие: её надо заметить самому.
  cron.schedule("10 * * * *", () => void runCaseDueJob());
  // Ящик заявок «это наш проект» — каждые пять минут: письмо проекта не должно
  // ждать час, а чаще незачем — ящик читается одним запросом.
  cron.schedule("*/5 * * * *", () => void runClaimMailboxJob());
  // Исходящие оповещения (CO): повторы считаются минутами, значит и прогон минутами.
  cron.schedule("*/2 * * * *", () => void runWebhookJob());
  // Жалобы на точки — раз в сутки: шаги лестницы считаются днями, частый
  // прогон ничего не ускорит.
  cron.schedule("20 5 * * *", () => void runPointReportJob());
  // Пересмотр залистованных предприятий — сразу после лестницы жалоб: шаги
  // тоже считаются днями.
  cron.schedule("35 5 * * *", () => void runCompanyReviewJob());
  // Автозаказ — раз в сутки, рядом с остальными суточными: порог меряется днями
  // поставки, и частый прогон ничего не ускорит. Прогон формирует **черновик** —
  // отправка заказа остаётся обещанием человека.
  cron.schedule("30 5 * * *", () => void runReorderJob());
  // Пересмотр доступа — рядом с пересмотром предприятий: обе ревизии суточные,
  // обе адресованы владельцу, и читать их удобнее одним утром.
  cron.schedule("45 5 * * *", () => void runStaffAccessReviewJob());
  // Прогрев переводов: дважды в сутки, чтобы правка карточки доехала до всех
  // локалей раньше, чем в неё зайдёт первый посетитель или робот.
  cron.schedule("25 3,15 * * *", () => void runProseWarmup());
  cron.schedule("10 5 * * *", () => void runContractVerify());
  cron.schedule("*/10 * * * *", () => void runCardMarketSync());
  cron.schedule("20 * * * *", () => void runClaimSweep());
  // Факты сети — на :35, чтобы не толкаться с заявками (:20) и выпуском (:45).
  cron.schedule("35 * * * *", () => void runChainFactsSweep());
  cron.schedule("45 * * * *", () => void runSupplySweep());
  cron.schedule("25 4 * * *", () => void runListingSweepJob());
  // Посев рынков — после конвейера листинга: карточка, открытая им сегодня,
  // получает рынки тем же утром.
  // Цена монетам с карточкой — до посева рынков: посев сверяет найденную цену
  // с опорной из последнего снимка, и без свежей опоры он отказывается сеять.
  cron.schedule("12 * * * *", () => void runCardedCoinPriceSync());
  cron.schedule("40 4 * * *", () => void runCardMarketSeedJob());
  cron.schedule("50 * * * *", () => void runOwnDexMarketJob());
  cron.schedule("0 4 * * *", () => void runCleanup());
  // Отчёт здоровья — в 06:00 UTC (09:00 МСК): после всех ночных прогонов, чтобы
  // их свежесть считалась по уже прошедшим, а не по ещё не начавшимся.
  cron.schedule("0 6 * * *", () => void runHealthReportJob());
  // Приём платежей (слайс CP): суточная проверка ссылок и исполнение отложенных смен.
  cron.schedule("40 5 * * *", () => void runPayLinkJob());
  cron.schedule("*/10 * * * *", () => void runPayLinkDueJob());
  // Санкционный список (слайс CR): в 05:50, до ночного отчёта в 06:00 — тогда отчёт
  // говорит о сегодняшнем состоянии списка, а не о вчерашнем.
  cron.schedule("50 5 * * *", () => void runSanctionsJob());

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
