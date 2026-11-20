import type { MarketRow, GlobalSnap, ExchangeRates, CoinDetail, Exchange } from "@/lib/coingecko";
import type { NewsItem } from "@/lib/news";
import type { FearGreed } from "@/lib/fear-greed";
import { marketFetchOrder, type MarketAskedAt, type MarketInstrument, type MarketQuote, type MarketSweep } from "@/lib/markets";
import { KEYS, TTL } from "./keys";
import { mergeCuratedExchanges } from "@/lib/curated-exchanges";
import { cpTypeToExchangeType, resolveCpId, type CoinPaprikaExchange, type CoinPaprikaExchangeDetail, type CoinPaprikaMarket } from "@/lib/coinpaprika";
import { CgHttpError } from "@/lib/coingecko-http";
import { isCpQuotaError } from "@/lib/coinpaprika-http";
import { PAIR_MAX_AGE_MS, matchExchange, type CoinloreExchange, type CoinlorePair } from "@/lib/coinlore";

// Minimal interfaces — we only use what we need so tests can pass fakes.
type RedisLike = {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

type PrismaLike = {
  coin: {
    upsert(args: {
      where: { id: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
  coinSnapshot: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  globalStats: {
    upsert(args: {
      where: { id: number };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    findUnique?(args: { where: { id: number } }): Promise<{ total24hVolumeUsd?: unknown } | null>;
  };
};

export async function syncPrices(deps: {
  fetchTop100L1: () => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const rows = await deps.fetchTop100L1();
  // Пустой ответ — сорванное чтение, а не пустой рынок: в категории layer-1
  // всегда около сотни монет. Записанный пустым снимок читатель счёл бы годным
  // (см. `readTop100`) и четверть часа отдавал бы главную без списка, поэтому
  // прогон падает вслух, а прежний снимок остаётся на месте.
  if (rows.length === 0) throw new Error("coingecko /coins/markets returned no rows");

  // Write Redis snapshot first — fast cache for readers.
  const listJson = JSON.stringify(rows);
  await deps.redis.set(KEYS.topList, listJson, "EX", TTL.snapshot);

  // Per-coin snapshot (used by future detail pages).
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
  }

  // Durable writes.
  for (const r of rows) {
    const slug = r.id; // CoinGecko id is already a slug.
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "AUTO_L1",
      },
    });
    await deps.prisma.coinSnapshot.create({
      data: {
        coinId: r.id,
        priceUsd: r.priceUsd,
        marketCapUsd: r.marketCapUsd,
        volume24hUsd: r.volume24hUsd,
        pctChange1h: r.pctChange1h,
        pctChange24h: r.pctChange24h,
        pctChange7d: r.pctChange7d,
        circulatingSupply: r.circulatingSupply,
        totalSupply: r.totalSupply,
        maxSupply: r.maxSupply,
        sparkline7d: r.sparkline7d,
      },
    });
  }

  return { count: rows.length };
}

export async function syncGlobal(deps: {
  fetchGlobalSnap: () => Promise<GlobalSnap>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<void> {
  const snap = await deps.fetchGlobalSnap();
  // CoinGecko's /global intermittently answers with total_volume.usd = 0 while
  // it recomputes. Zero is never a real 24h turnover, and writing it blanks the
  // homepage ticker for the next half hour — keep the last known good number.
  if (!(snap.total24hVolumeUsd > 0)) {
    const prev = await deps.prisma.globalStats.findUnique?.({ where: { id: 1 } });
    const prevVolume = Number(prev?.total24hVolumeUsd ?? 0);
    if (prevVolume > 0) snap.total24hVolumeUsd = prevVolume;
  }
  await deps.redis.set(KEYS.globalStats, JSON.stringify(snap), "EX", TTL.globalStats);
  await deps.prisma.globalStats.upsert({
    where: { id: 1 },
    update: { ...snap },
    create: { id: 1, ...snap },
  });
}

export async function syncExchangeRates(deps: {
  fetchExchangeRates: () => Promise<ExchangeRates>;
  redis: RedisLike;
}): Promise<void> {
  const rates = await deps.fetchExchangeRates();
  await deps.redis.set(KEYS.exchangeRates, JSON.stringify(rates), "EX", TTL.exchangeRates);
}

export async function syncNews(deps: {
  fetchNews: () => Promise<NewsItem[]>;
  redis: RedisLike;
}): Promise<{ count: number }> {
  const items = await deps.fetchNews();
  await deps.redis.set(KEYS.news, JSON.stringify(items), "EX", TTL.news);
  return { count: items.length };
}

export async function syncFearGreed(deps: {
  fetchFearGreed: () => Promise<FearGreed>;
  redis: RedisLike;
}): Promise<{ value: number }> {
  const fg = await deps.fetchFearGreed();
  await deps.redis.set(KEYS.fearGreed, JSON.stringify(fg), "EX", TTL.fearGreed);
  return { value: fg.value };
}

export async function syncMarkets(deps: {
  fetchMarkets: (order?: MarketInstrument[]) => Promise<MarketSweep>;
  redis: RedisLike & { get(key: string): Promise<string | null> };
  now?: () => Date;
}): Promise<{ count: number }> {
  const now = deps.now ?? (() => new Date());

  // Очередь обхода — по нашей карте спросов, а не по штампу котировки: штамп
  // принадлежит рынку, у закрытого рынка он не двигается, и такой инструмент
  // навсегда стоял первым и навсегда получал 429 (см. `marketFetchOrder`).
  let asked: MarketAskedAt = {};
  try {
    const cached = await deps.redis.get(KEYS.marketsAsked);
    const parsed = cached ? JSON.parse(cached) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      asked = parsed as MarketAskedAt;
    }
  } catch {
    asked = {};
  }

  // Прошлый снимок читается ДО запроса: за не прошедшие карточки он подставит
  // прежние значения — служба отдаёт за прогон одну-две из десяти.
  let previous: MarketQuote[] = [];
  try {
    const cached = await deps.redis.get(KEYS.markets);
    const parsed = cached ? JSON.parse(cached) : null;
    if (Array.isArray(parsed)) previous = parsed as MarketQuote[];
  } catch {
    previous = [];
  }

  const sweep = await deps.fetchMarkets(marketFetchOrder(asked));

  // Спрос записывается до любых разборов ответа и независимо от того, прошла
  // ли хоть одна котировка: иначе очередь не двигается, получивший отказ по
  // частоте снова встаёт первым и снова его получает — живое голодание
  // платины с палладием, которые за сутки не снялись ни разу.
  if (sweep.asked.length > 0) {
    const stamp = now().toISOString();
    const next: MarketAskedAt = { ...asked };
    for (const symbol of sweep.asked) next[symbol] = stamp;
    await deps.redis.set(KEYS.marketsAsked, JSON.stringify(next), "EX", TTL.marketsAsked);
  }

  const quotes = sweep.quotes;
  // An empty result means the upstream refused us, not that the markets are gone —
  // keep the last good snapshot so the board degrades to stale instead of blank.
  //
  // «Оставить» значит перезаписать теми же значениями: снимок живёт сутки, а
  // источник отказывал нам сутками напролёт (живой случай CNBC 17 ноября) —
  // ключ истекал, и табло гасло вовсе. Ветхая котировка со своим штампом
  // честнее пустого табло. Свежесть после этого мерится не временем записи, а
  // штампом самой ветхой карточки (`stalestQuoteAt`) — иначе продление срока
  // выглядело бы как свежий ответ службы.
  const stampedAt = now().toISOString();
  // Снимок прежней формы штампов не нёс. Такой карточке ставится штамп этого
  // прогона — перенос одноразовый, и возраст её отсчитывается с него. Правило
  // одно на оба пути: иначе снимок, доживший до правки, так и остался бы без
  // штампов, пока служба молчит, — то есть ровно тогда, когда возраст и нужен.
  const carry = (p: MarketQuote): MarketQuote => (p.gotAt ? p : { ...p, gotAt: stampedAt });

  if (quotes.length === 0) {
    if (previous.length > 0) {
      await deps.redis.set(KEYS.markets, JSON.stringify(previous.map(carry)), "EX", TTL.markets);
    }
    return { count: 0 };
  }

  // Источник иногда теряет один символ из в остальном годного ответа (у Yahoo
  // это отдельный запрос на инструмент, и сорваться может именно он). Слияние с
  // прошлым снимком оставляет такую карточку на табло — ветхой, со своим
  // штампом, — вместо того чтобы гасить её до следующего прогона.
  const fresh = new Map(quotes.map((q) => [q.symbol, q]));
  // Наш штамп ставится здесь, а не в разборе ответа: разбор чистый, а время
  // взятия — факт прогона. Перенесённая карточка свой штамп сохраняет, иначе
  // её возраст обнулялся бы чужим ответом.
  // Previous order is the canonical instrument order, so rebuild from it and append
  // anything newly added to the instrument list.
  const merged = [
    ...previous.map((p) => {
      const f = fresh.get(p.symbol);
      return f ? { ...f, gotAt: stampedAt } : carry(p);
    }),
    ...quotes.filter((q) => !previous.some((p) => p.symbol === q.symbol)).map((q) => ({ ...q, gotAt: stampedAt })),
  ];

  await deps.redis.set(KEYS.markets, JSON.stringify(merged), "EX", TTL.markets);
  return { count: quotes.length };
}

type PrismaCoinMetaUpdate = {
  coin: {
    findMany(args: {
      where: { isActive: boolean; OR?: Array<unknown> };
      orderBy: { rank: "asc" };
      select: { id: true; metadataFetchedAt: true };
    }): Promise<Array<{ id: string; metadataFetchedAt: Date | null }>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function syncCoinMetadata(deps: {
  fetchCoinDetail: (id: string) => Promise<CoinDetail>;
  prisma: PrismaCoinMetaUpdate;
  /**
   * Когда монете в последний раз писали цену. Нужна только при 404: без неё
   * «нет такой монеты» остаётся обычным сбоем — не зная, жив ли ключ, монету
   * не скрываем.
   */
  lastPricedAt?: (id: string) => Promise<Date | null>;
  // ms between fetches — Free tier ~30 req/min → 2000ms is comfortable
  delayMs?: number;
  // skip coins fetched within this window (default 23h)
  staleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ updated: number; skipped: number; failed: number; retired: number }> {
  const delayMs = deps.delayMs ?? 4000;
  // 7-day stale window — descriptions barely change, keeps monthly CoinGecko budget low.
  const staleMs = deps.staleMs ?? 7 * 24 * 60 * 60 * 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = Date.now();

  const coins = await deps.prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    select: { id: true, metadataFetchedAt: true },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let retired = 0;

  for (const c of coins) {
    if (c.metadataFetchedAt && now - c.metadataFetchedAt.getTime() < staleMs) {
      skipped++;
      continue;
    }
    try {
      const d = await deps.fetchCoinDetail(c.id);
      await deps.prisma.coin.update({
        where: { id: c.id },
        data: {
          description: d.descriptionEn,
          websiteUrl: d.websiteUrl,
          explorerUrl: d.explorerUrl,
          whitepaperUrl: d.whitepaperUrl,
          githubUrl: d.githubUrl,
          twitterUrl: d.twitterUrl,
          redditUrl: d.redditUrl,
          metadataFetchedAt: new Date(),
        },
      });
      updated++;
    } catch (err) {
      // 404 — приговор каталога источника, а не сбой связи: ключа у него больше
      // нет, значит метаданных этой монете не напишет никто и впредь. Такая
      // монета стоила по вызову за прогон вечно (живой случай 19 ноября —
      // `coinex-token`), а каждый вызов сверх запаса бесплатного тарифа
      // отбирается у живых посетителей: лимит считается по адресу и общий у
      // веба с воркером.
      //
      // Скрываем, только когда цены ей тоже никто не пишет. Строка в сотне
      // категории layer-1 получает цену каждые десять минут — такой 404 означал
      // бы сбой на стороне службы, и монету со свежей ценой этот путь не тронет
      // никогда. Скрытие обратимо из админки (`toggleCoinActive`).
      const gone = err instanceof CgHttpError && err.status === 404;
      const pricedAt = gone && deps.lastPricedAt ? await deps.lastPricedAt(c.id) : null;
      if (gone && deps.lastPricedAt && (!pricedAt || now - pricedAt.getTime() > staleMs)) {
        await deps.prisma.coin.update({ where: { id: c.id }, data: { isActive: false } });
        retired++;
        console.warn(`[worker] metadata-sync ${c.id}: исчезла из каталога CoinGecko (404) и цены не получает — скрыта`);
      } else {
        failed++;
        console.error(`[worker] metadata-sync ${c.id} failed:`, err);
      }
    }
    await sleep(delayMs);
  }

  return { updated, skipped, failed, retired };
}

export async function syncExchanges(deps: {
  fetchExchanges: (btcUsd: number) => Promise<Exchange[]>;
  btcUsd: number;
  redis: RedisLike;
  prisma: {
    exchange: {
      upsert(args: {
        where: { id: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
}): Promise<{ count: number }> {
  const list = mergeCuratedExchanges(await deps.fetchExchanges(deps.btcUsd));
  await deps.redis.set(KEYS.exchangesList, JSON.stringify(list), "EX", TTL.exchanges);

  for (const e of list) {
    await deps.prisma.exchange.upsert({
      where: { id: e.id },
      update: {
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
      create: {
        id: e.id,
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
    });
  }
  return { count: list.length };
}

export async function syncAdminAddedPrices(deps: {
  // Returns admin-added coin ids; empty array means "nothing to do".
  listAdminAddedIds: () => Promise<string[]>;
  fetchByIds: (ids: string[]) => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const ids = await deps.listAdminAddedIds();
  if (ids.length === 0) {
    // Clear stale snapshot so the public listing doesn't show orphaned admin coins.
    await deps.redis.set(KEYS.adminAddedList, JSON.stringify([]), "EX", TTL.adminAddedList);
    return { count: 0 };
  }

  const rows = await deps.fetchByIds(ids);
  await deps.redis.set(KEYS.adminAddedList, JSON.stringify(rows), "EX", TTL.adminAddedList);

  // Per-coin cache + DB snapshot, same as syncPrices.
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      // ADMIN_ADDED row already exists from approval; this branch is a defensive fallback.
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug: r.id,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "ADMIN_ADDED",
      },
    });
    await deps.prisma.coinSnapshot.create({
      data: {
        coinId: r.id,
        priceUsd: r.priceUsd,
        marketCapUsd: r.marketCapUsd,
        volume24hUsd: r.volume24hUsd,
        pctChange1h: r.pctChange1h,
        pctChange24h: r.pctChange24h,
        pctChange7d: r.pctChange7d,
        circulatingSupply: r.circulatingSupply,
        totalSupply: r.totalSupply,
        maxSupply: r.maxSupply,
        sparkline7d: r.sparkline7d,
      },
    });
  }
  return { count: rows.length };
}

/** Строка выборки: монета с опубликованной карточкой и время её последнего снимка. */
export type CardedCoinRow = { coinId: string; lastSnapshotAt: Date | null };

/**
 * Час: главный прогон цен ходит раз в десять минут, поэтому монета, которую
 * приносит список top-100, под это правило не попадает никогда, а выпавшая из
 * списка попадает всегда.
 */
const CARDED_PRICE_STALE_MS = 60 * 60 * 1000;

/** Кому из монет с карточкой цену никто не принёс. Чистое правило — отдельно от запроса. */
export function staleCardedIds(rows: readonly CardedCoinRow[], now: Date): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.coinId)) continue;
    const stale =
      r.lastSnapshotAt === null ||
      now.getTime() - r.lastSnapshotAt.getTime() > CARDED_PRICE_STALE_MS;
    if (!stale) continue;
    seen.add(r.coinId);
    out.push(r.coinId);
  }
  return out;
}

/**
 * Цены монет, у которых есть опубликованная карточка, но которых не приносит
 * ни один из двух прежних прогонов.
 *
 * `syncPrices` пишет снимок только тому, что пришло в ответе CoinGecko по
 * категории layer-1, а `syncAdminAddedPrices` — только заведённому руками.
 * Монета, которая когда-то была в категории, а потом выпала из сотни, остаётся
 * в каталоге как `AUTO_L1` и цены не получает никогда. Живой случай 18 ноября:
 * Moonbeam, Moonriver, Secret, AtomOne и Saga стояли с опубликованной карточкой
 * и нулём снимков за всю жизнь, из-за чего посев рынков отказывал по
 * `no_reference` (опорная цена сверяет тикер-двойник), а в карточке молчали
 * капитализация, график и комиссия перевода в долларах.
 *
 * В общий список монет (`adminAddedList`) эти монеты сознательно не кладутся:
 * таблица на главной называется «Top Layer-1», и дописать в неё монету из-за
 * сотни — значит сменить обещание таблицы, а не починить цену. Карточке и
 * посеву рынков хватает снимка в базе и ключа монеты в Redis.
 */
export async function syncCardedCoinPrices(deps: {
  listStaleCardedIds: () => Promise<string[]>;
  fetchByIds: (ids: string[]) => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const ids = await deps.listStaleCardedIds();
  if (ids.length === 0) return { count: 0 };

  const rows = await deps.fetchByIds(ids);
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: { symbol: r.symbol, name: r.name, logoUrl: r.logoUrl, rank: r.rank },
      // Монета уже есть — карточка без строки `Coin` не создаётся; ветка оборонительная.
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug: r.id,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "AUTO_L1",
      },
    });
    await deps.prisma.coinSnapshot.create({
      data: {
        coinId: r.id,
        priceUsd: r.priceUsd,
        marketCapUsd: r.marketCapUsd,
        volume24hUsd: r.volume24hUsd,
        pctChange1h: r.pctChange1h,
        pctChange24h: r.pctChange24h,
        pctChange7d: r.pctChange7d,
        circulatingSupply: r.circulatingSupply,
        totalSupply: r.totalSupply,
        maxSupply: r.maxSupply,
        sparkline7d: r.sparkline7d,
      },
    });
  }
  return { count: rows.length };
}

function pickFirst(arr: string[] | undefined): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const v = arr[0];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function socialsFromLinks(links: CoinPaprikaExchange["links"]): Record<string, string> | null {
  const out: Record<string, string> = {};
  const tw = pickFirst(links.twitter); if (tw) out.twitter = tw;
  const tg = pickFirst(links.telegram); if (tg) out.telegram = tg;
  const fb = pickFirst(links.facebook); if (fb) out.facebook = fb;
  const gh = pickFirst(links.github); if (gh) out.github = gh;
  const rd = pickFirst(links.reddit); if (rd) out.reddit = rd;
  const yt = pickFirst(links.youtube); if (yt) out.youtube = yt;
  const ws = pickFirst(links.website); if (ws) out.website = ws;
  return Object.keys(out).length > 0 ? out : null;
}

function marketRowId(exchangeId: string, m: CoinPaprikaMarket): string {
  const cat = m.category ?? "spot";
  return `${exchangeId}:${m.baseSymbol}:${m.quoteSymbol}:${cat}`;
}

export async function syncCoinPaprikaExchanges(deps: {
  fetchAll: () => Promise<CoinPaprikaExchange[]>;
  fetchDetail: (id: string) => Promise<CoinPaprikaExchangeDetail | null>;
  prisma: {
    exchange: {
      findUnique(args: { where: { id: string } }): Promise<{ id: string; description: string | null; exchangeType: string | null; currencies: number | null; pairsCount: number | null; fiats: string[]; socials: unknown; source: string } | null>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
    exchangeMarket: {
      upsert(args: { where: { id: string }; update: Record<string, unknown>; create: Record<string, unknown> }): Promise<unknown>;
    };
  };
  minVolumeUsd: number;
  btcUsd: number;
  /** Hard cap on per-exchange detail calls per run — CoinPaprika free tier is 60 req/hour. */
  detailCallBudget: number;
  // Подробности, на которые служба ответила, считаются отдельно от попыток:
  // `fetchDetail` молчание службы превращает в null (не повод валить обход), и
  // строка лога «11 details» одинаково выглядела при одиннадцати ответах и при
  // одиннадцати отказах — то есть исчерпанный запас в ней был не виден.
}): Promise<{ created: number; enriched: number; skipped: number; marketsUpserted: number; detailsAttempted: number; detailsOk: number; quotaExhausted: boolean }> {
  const allRaw = await deps.fetchAll();
  // Sort by volume desc so top exchanges get fresh detail first within rate-limit budget.
  const all = [...allRaw].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  let created = 0, enriched = 0, skipped = 0, marketsUpserted = 0, detailsAttempted = 0, detailsOk = 0;
  // Исчерпанный запас месяца — отказ всей службе: спрашивать о следующей бирже
  // бессмысленно, а числа из списка уже у нас одним запросом, и записать их надо
  // всем — иначе объёмы 580 бирж стояли бы ветхими до обновления запаса.
  let quotaExhausted = false;

  for (const cp of all) {
    if (!cp.active || !cp.markets_data_fetched || cp.volume24hUsd <= deps.minVolumeUsd) {
      skipped++;
      continue;
    }
    const targetId = resolveCpId(cp.id);
    const existing = await deps.prisma.exchange.findUnique({ where: { id: targetId } });
    const wantDetail = !quotaExhausted && detailsAttempted < deps.detailCallBudget;
    let detail: CoinPaprikaExchangeDetail | null = null;
    if (wantDetail) {
      detailsAttempted++;
      try {
        detail = await deps.fetchDetail(cp.id);
      } catch (err) {
        if (!isCpQuotaError(err)) throw err;
        quotaExhausted = true;
      }
    }
    if (detail) detailsOk++;
    const pairsCount = detail?.pairsCount ?? null;
    const fiats = cp.fiats.map((f) => f.symbol).filter((s): s is string => typeof s === "string" && s.length > 0);
    const socials = socialsFromLinks(cp.links);
    const exchangeType = cpTypeToExchangeType(cp.type);
    const volBtc = deps.btcUsd > 0 ? cp.volume24hUsd / deps.btcUsd : 0;

    if (existing) {
      // Always refresh volatile metrics; only fill in nullable curated fields once.
      const data: Record<string, unknown> = {
        volume24hUsd: cp.volume24hUsd,
        volume24hBtc: volBtc,
        trustScoreRank: cp.adjusted_rank ?? null,
      };
      if (cp.currencies !== null) data.currencies = cp.currencies;
      if (pairsCount !== null) data.pairsCount = pairsCount;
      if (existing.description === null && cp.description) data.description = cp.description;
      if (existing.exchangeType === null && exchangeType) data.exchangeType = exchangeType;
      if ((!existing.fiats || existing.fiats.length === 0) && fiats.length > 0) data.fiats = fiats;
      if (!existing.socials && socials) data.socials = socials;
      if (detail && detail.markets.length > 0) data.marketsFetchedAt = new Date();
      await deps.prisma.exchange.update({ where: { id: targetId }, data });
      enriched++;
    } else {
      const websiteUrl = pickFirst(cp.links.website) ?? null;
      const create: Record<string, unknown> = {
        id: cp.id,
        name: cp.name,
        logoUrl: `https://static.coinpaprika.com/exchange/${cp.id}/logo.png`,
        country: null,
        yearEstablished: null,
        trustScore: null,
        trustScoreRank: cp.adjusted_rank ?? null,
        volume24hUsd: cp.volume24hUsd,
        volume24hBtc: volBtc,
        url: websiteUrl,
        hasTradingIncentive: false,
        description: cp.description,
        exchangeType,
        currencies: cp.currencies,
        pairsCount,
        fiats,
        socials,
        source: "cp",
        marketsFetchedAt: detail && detail.markets.length > 0 ? new Date() : null,
      };
      await deps.prisma.exchange.create({ data: create });
      created++;
    }

    if (detail && detail.markets.length > 0) {
      const now = new Date();
      for (const m of detail.markets) {
        if (!m.baseSymbol || !m.quoteSymbol) continue;
        const id = marketRowId(targetId, m);
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
        await deps.prisma.exchangeMarket.upsert({
          where: { id },
          update: common,
          create: { id, exchangeId: targetId, firstSeenAt: now, ...common },
        });
        marketsUpserted++;
      }
    }
  }

  return { created, enriched, skipped, marketsUpserted, detailsAttempted, detailsOk, quotaExhausted };
}

/**
 * Пары бирж от Coinlore — бесплатно, без ключа и без месячного запаса.
 *
 * Заполняет `pairsCount` и строки `ExchangeMarket` — таблицу, пустую у всех 581
 * биржи с начала проекта (слайс AD это записал, но наполнять её было нечем:
 * подробности CoinPaprika упирались в месячный запас, уборка BH — в его
 * исчерпание).
 *
 * **Новых бирж не заводит и объём чужой строки не затирает.** Каталог и так
 * наполняют два источника, и в базе уже лежат `gate` и `gateio`, `bybit_spot` и
 * `bybit-spot` — одна биржа двумя строками; третий автор умножил бы это. Объём
 * пишется только там, где у нашей строки его нет: автор значения один.
 */
export async function syncCoinloreExchanges(deps: {
  fetchExchanges: () => Promise<CoinloreExchange[]>;
  fetchPairs: (id: string) => Promise<CoinlorePair[]>;
  prisma: {
    exchange: {
      findMany(args: { select: Record<string, boolean> }): Promise<{ id: string; name: string; volume24hUsd: number | null }[]>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    exchangeMarket: {
      upsert(args: { where: { id: string }; update: Record<string, unknown>; create: Record<string, unknown> }): Promise<unknown>;
    };
  };
  /** Сколько бирж спросить о парах за прогон — считает бюджет (`planRun`). */
  pairBudget: number;
  now: Date;
}): Promise<{
  matched: number;
  unmatched: number;
  marketsUpserted: number;
  pairsStale: number;
  pairFailures: number;
  pairsSkippedByBudget: number;
}> {
  const ours = await deps.prisma.exchange.findMany({ select: { id: true, name: true, volume24hUsd: true } });
  const list = [...(await deps.fetchExchanges())].sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));

  let matched = 0, unmatched = 0, marketsUpserted = 0, pairsStale = 0, pairFailures = 0, pairsSkippedByBudget = 0;
  let pairCalls = 0;

  for (const cl of list) {
    const ourId = matchExchange(cl, ours);
    if (!ourId) {
      unmatched++;
      continue;
    }
    matched++;
    const existing = ours.find((o) => o.id === ourId);

    const data: Record<string, unknown> = {};
    if (cl.activePairs !== null) data.pairsCount = cl.activePairs;
    // Объём — только в пустое место: у строки уже есть автор (CoinGecko или
    // CoinPaprika), и второе число той же величины разошлось бы с первым.
    if (cl.volumeUsd !== null && (existing?.volume24hUsd === null || existing?.volume24hUsd === undefined)) {
      data.volume24hUsd = cl.volumeUsd;
    }

    let pairs: CoinlorePair[] | null = null;
    if (pairCalls < deps.pairBudget) {
      pairCalls++;
      try {
        pairs = await deps.fetchPairs(cl.id);
      } catch {
        // Сбой пар одной биржи прогон не роняет: у остальных данные свои.
        pairFailures++;
      }
    } else {
      pairsSkippedByBudget++;
    }

    let wrote = 0;
    for (const p of pairs ?? []) {
      // Пара, не торговавшаяся неделю, не пишется вовсе: биржа её сняла, а
      // показанная как живая она была бы той самой ложью, которую починила AV.
      if (p.tradedAt && deps.now.getTime() - p.tradedAt.getTime() > PAIR_MAX_AGE_MS) {
        pairsStale++;
        continue;
      }
      const id = `${ourId}:${p.base}:${p.quote}:spot`;
      const common = {
        pair: `${p.base}/${p.quote}`,
        baseSymbol: p.base,
        quoteSymbol: p.quote,
        category: "spot",
        priceUsd: p.priceUsd,
        volumeUsd24h: p.volumeUsd,
        lastTradedAt: p.tradedAt,
        lastSeenAt: deps.now,
      };
      await deps.prisma.exchangeMarket.upsert({
        where: { id },
        update: common,
        create: { id, exchangeId: ourId, ...common },
      });
      wrote++;
      marketsUpserted++;
    }
    if (wrote > 0) data.marketsFetchedAt = deps.now;

    if (Object.keys(data).length > 0) await deps.prisma.exchange.update({ where: { id: ourId }, data });
  }

  return { matched, unmatched, marketsUpserted, pairsStale, pairFailures, pairsSkippedByBudget };
}
