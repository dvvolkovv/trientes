import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { fetchCoinPaprikaExchangeDetail, type CoinPaprikaMarket } from "@/lib/coinpaprika";

export type ExchangeFresh = {
  cpId: string;
  volume24hUsd: number;
  currencies: number | null;
  pairsCount: number;
  fetchedAt: string; // ISO
};

const TTL_SECONDS = 60 * 5;
const NEG_TTL_SECONDS = 60; // short — try again soon if upstream is down/rate-limited

/**
 * Сколько страница ждёт чужую службу. Три секунды — тот же срок, что у рельса
 * пожертвований на главной: у страницы уже есть числа из базы со своим штампом
 * времени, и живой посетитель не должен платить за молчание CoinPaprika.
 *
 * Живой случай 19 ноября: запас месяца исчерпан, каждый 402 повторялся через 10
 * и 30 секунд, страница биржи отдавалась **50 секунд**. Обход поисковика по
 * двенадцати языкам разом догонял веб до 800 МБ, pm2 перезапускал его по памяти
 * (17:03, 17:34, 18:36), и в эти секунды все посетители получали 502.
 */
export const FRESH_DEADLINE_MS = 3_000;

/**
 * Запросы в полёте по ключу биржи. Двенадцать языков одной страницы — это один
 * вопрос службе, а не двенадцать: без этого обход поисковика множил и запросы, и
 * память на число локалей.
 */
const inFlight = new Map<string, Promise<ExchangeFresh | null>>();

function marketRowId(exchangeId: string, m: CoinPaprikaMarket): string {
  const cat = m.category ?? "spot";
  return `${exchangeId}:${m.baseSymbol}:${m.quoteSymbol}:${cat}`;
}

async function hydrateMarkets(exchangeId: string, markets: CoinPaprikaMarket[]): Promise<void> {
  if (markets.length === 0) return;
  const now = new Date();
  for (const m of markets) {
    if (!m.baseSymbol || !m.quoteSymbol) continue;
    const id = marketRowId(exchangeId, m);
    const common = {
      pair: m.pair,
      baseSymbol: m.baseSymbol,
      quoteSymbol: m.quoteSymbol,
      baseCurrencyId: m.baseCurrencyId,
      quoteCurrencyId: m.quoteCurrencyId,
      category: m.category,
      priceUsd: m.priceUsd,
      volumeUsd24h: m.volumeUsd24h,
      volumeSharePct: m.volumeSharePct,
      outlier: m.outlier,
      marketUrl: m.marketUrl,
      lastTradedAt: m.lastTradedAt,
      lastSeenAt: now,
    };
    try {
      await prisma.exchangeMarket.upsert({
        where: { id },
        update: common,
        create: { id, exchangeId, firstSeenAt: now, ...common },
      });
    } catch {
      // ignore — exchange row may have been deleted, or transient db hiccup
    }
  }
  try {
    await prisma.exchange.update({
      where: { id: exchangeId },
      data: { marketsFetchedAt: now },
    });
  } catch {
    // ignore
  }
}

/**
 * Returns fresh aggregate metrics for an exchange from CoinPaprika, cached 5 min.
 * Also hydrates the ExchangeMarket table from the response so the pair table populates
 * for any exchange a user actually views (avoids relying on the rate-limited cron).
 * Falls back to null on upstream failure (caller should use DB values).
 */
export async function getFreshExchangeDetail(
  cpId: string,
  exchangeId: string,
): Promise<ExchangeFresh | null> {
  const running = inFlight.get(cpId);
  if (running) return running;
  const started = read(cpId, exchangeId).finally(() => {
    inFlight.delete(cpId);
  });
  inFlight.set(cpId, started);
  return started;
}

async function read(cpId: string, exchangeId: string): Promise<ExchangeFresh | null> {
  const key = `exch-fresh:${cpId}`;
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      if (cached === "") return null;
      return JSON.parse(cached) as ExchangeFresh;
    }
  } catch {
    // ignore
  }

  let detail;
  try {
    // Срок: что не успело к отрисовке, для этой страницы не существует. Сам
    // запрос продолжает жить — его ответ просто ляжет в снимок для следующего.
    detail = await Promise.race([
      fetchCoinPaprikaExchangeDetail(cpId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FRESH_DEADLINE_MS)),
    ]);
  } catch {
    detail = null;
  }

  if (!detail) {
    try {
      await redis.set(key, "", "EX", NEG_TTL_SECONDS);
    } catch {
      // ignore
    }
    return null;
  }

  // Fire-and-forget market hydration so the page render isn't blocked on DB writes.
  void hydrateMarkets(exchangeId, detail.markets);

  const fresh: ExchangeFresh = {
    cpId,
    volume24hUsd: detail.volume24hUsd,
    currencies: detail.currencies,
    pairsCount: detail.pairsCount,
    fetchedAt: new Date().toISOString(),
  };
  try {
    await redis.set(key, JSON.stringify(fresh), "EX", TTL_SECONDS);
  } catch {
    // ignore
  }
  return fresh;
}
