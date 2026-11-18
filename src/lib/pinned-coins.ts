import type { MarketRow } from "@/lib/coingecko";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { KEYS, TTL } from "@/lib/sync/keys";
import { circulatingCoins } from "@/lib/coin-card-circulating";
import { coinsToNumber } from "@/lib/coin-card-supply";

/**
 * Строка основного списка монет. От `MarketRow` отличается одним: капитализации
 * может не быть вовсе.
 *
 * У монеты, которой торгует один маркетмейкер, капитализация целиком следует из
 * его цены и читается как утверждение о размере рынка, которого нет (у Taler
 * это 4,16 трлн $ при суточном обороте в двести долларов). Карточка это уже
 * решила — под ценой стоит оборот в монетах (`circulatingCoins`), — и список
 * обязан говорить то же самое. Нет капитализации — нет и места в рейтинге:
 * рейтинг и есть порядок по капитализации, поэтому такая строка `unranked`, а
 * `rank` у неё только ключ сортировки.
 */
export type ListRow = Omit<MarketRow, "marketCapUsd"> & {
  marketCapUsd: number | null;
  unranked?: boolean;
  /**
   * Номер строки в нашем списке, считая с единицы. Это не место в мировом
   * рейтинге: `rank` приходит от CoinGecko и в списке разрежен (1, 2, 4, 6, 7,
   * 8, 10…), потому что страница показывает категорию layer-1, а не весь рынок.
   * На экране разрежённые числа читаются как пропуски строк, а у закреплённой
   * монеты места в рейтинге нет вовсе и столбец показывал «—».
   *
   * Поэтому номер считает `insertPinned` по порядку самого списка: Taler стоит
   * восьмым и носит номер 8, следующая монета — 9. Ставит его только главная;
   * в закладках строк мало и своих мест у них нет, там по-прежнему виден `rank`.
   */
  listNo?: number;
};

/** Строка, которую мы ставим в список сами, со своим местом (считая с единицы). */
export type PinnedListRow = ListRow & { position: number };

/** Монеты, закреплённые в основном списке решением владельца. */
export const PINNED_CARD_COINS: readonly { slug: string; position: number }[] = [
  { slug: "taler", position: 8 },
];

/**
 * Свежесть индекса, при которой цену ещё можно ставить в список. Прогон своего
 * обмена ходит раз в час; молчавший пять дней читатель (живой случай 13–18
 * ноября) не должен оставлять в списке цену, которой никто не подтверждал —
 * лучше строки нет вовсе, чем строка с ценой прошлой недели.
 */
const INDEX_FRESH_MS = 6 * 60 * 60 * 1000;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Вставка закреплённых строк на их места. Чистая функция: место названо
 * человеком, а `rank` считается от соседей, иначе сортировка по рейтингу
 * (она в списке стоит по умолчанию) увела бы строку с её места.
 *
 * Место считается по порядку рейтинга, а не по порядку в массиве: список
 * склеен из двух снимков (`readTop100` — сначала категория layer-1, потом
 * заведённые руками), и восьмая строка массива — не та, что восьмая на экране.
 * Живой прогон 18 ноября поймал это сразу: USDT и USDC лежат во второй
 * половине массива, но на экране стоят третьей и пятой, и Taler уехал на
 * десятое место вместо восьмого.
 */
export function insertPinned(
  list: readonly ListRow[],
  pinned: readonly PinnedListRow[],
): ListRow[] {
  const out: ListRow[] = [...list].sort((a, b) => a.rank - b.rank);
  const order = [...pinned].sort((a, b) => a.position - b.position);
  for (const p of order) {
    // Монета, которая пришла рыночным фидом, второй строкой не рисуется.
    if (out.some((r) => r.id === p.id)) continue;
    const at = Math.max(0, Math.min(out.length, p.position - 1));
    const prev = at > 0 ? out[at - 1] : null;
    const next = at < out.length ? out[at] : null;
    const rank =
      prev && next ? (prev.rank + next.rank) / 2
      : next ? next.rank - 1
      : prev ? prev.rank + 1
      : 1;
    const row: ListRow = { ...p };
    delete (row as { position?: number }).position;
    out.splice(at, 0, { ...row, rank });
  }
  // Нумерация по порядку списка, а не по мировому рейтингу: см. `listNo`.
  // `rank` остаётся ключом сортировки и не трогается — иначе строка, пришедшая
  // рыночным фидом, потеряла бы своё настоящее место в рейтинге.
  return out.map((r, i) => ({ ...r, listNo: i + 1 }));
}

/** Точка нашего часового ряда цен — всё, что нужно для линии и для изменения. */
export type PricePoint = { at: Date; priceUsd: number };

/**
 * Изменение цены за `hours` часов по нашему же ряду. Берётся ближайшая к сроку
 * точка внутри допуска: ряд часовой, но в нём бывают дыры (сорванное чтение
 * обмена), и считать «за сутки» от точки недельной давности нельзя.
 * Устаревший хвост ряда тоже отвергается — иначе прошлое выдавалось бы за
 * сегодняшнее.
 */
export function changeFromPoints(
  points: readonly PricePoint[],
  now: Date,
  hours: number,
): number | null {
  if (points.length < 2) return null;
  // Допуск узкий намеренно: живой ряд Taler 18 ноября имел дыру с 13-го, и при
  // допуске в четверть срока «за неделю» считалось бы от цены пятидневной
  // давности. Молчание честнее.
  const tolerance = Math.max(2, hours * 0.15) * 3600_000;
  const sorted = [...points].sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = sorted[0];
  if (now.getTime() - latest.at.getTime() > tolerance) return null;

  const target = latest.at.getTime() - hours * 3600_000;
  let ref: PricePoint | null = null;
  let best = Infinity;
  for (const p of sorted.slice(1)) {
    const diff = Math.abs(p.at.getTime() - target);
    if (diff <= tolerance && diff < best) {
      best = diff;
      ref = p;
    }
  }
  if (!ref || ref.priceUsd <= 0) return null;
  return ((latest.priceUsd - ref.priceUsd) / ref.priceUsd) * 100;
}

/** Линия за неделю из того же ряда. Одна точка линией не рисуется. */
export function sparklineFromPoints(
  points: readonly PricePoint[],
  now: Date,
): number[] | null {
  const fresh = points
    .filter((p) => now.getTime() - p.at.getTime() <= WEEK_MS)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (fresh.length < 2) return null;
  return fresh.map((p) => p.priceUsd);
}

type CardForList = {
  slug: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  coinId: string | null;
  tokenomics: unknown;
  priceIndex: { priceUsd: number; change24h: number | null; volumeUsd24h: number; computedAt: Date } | null;
  supply: { circulating: string; totalSupply: string; checkError: string | null } | null;
  pricePoints: PricePoint[];
};

/**
 * Строка списка из карточки монеты. Чистая часть чтения — вся в ней, поэтому
 * правило «что показывать, а что нет» проверяется без базы.
 */
export function buildPinnedRow(
  card: CardForList,
  position: number,
  now: Date,
): PinnedListRow | null {
  // Монета рыночного фида приходит общим списком — закреплять нечего.
  if (card.coinId) return null;
  const index = card.priceIndex;
  if (!index) return null;
  if (now.getTime() - index.computedAt.getTime() > INDEX_FRESH_MS) return null;

  const circulating = circulatingCoins(card);
  const claimed = (card.tokenomics ?? {}) as { max?: number | null };
  return {
    position,
    id: card.slug,
    symbol: card.symbol,
    name: card.name,
    logoUrl: card.logoUrl,
    rank: 0, // настоящий ключ сортировки ставит insertPinned по соседям
    priceUsd: index.priceUsd,
    // Капитализации у такой монеты нет по решению: см. комментарий к ListRow.
    marketCapUsd: null,
    unranked: true,
    volume24hUsd: index.volumeUsd24h,
    circulatingSupply: circulating?.coins ?? null,
    totalSupply: card.supply && !card.supply.checkError
      ? coinsToNumber(card.supply.totalSupply)
      : null,
    maxSupply: typeof claimed.max === "number" && claimed.max > 0 ? claimed.max : null,
    pctChange1h: changeFromPoints(card.pricePoints, now, 1),
    pctChange24h: index.change24h ?? changeFromPoints(card.pricePoints, now, 24),
    pctChange7d: changeFromPoints(card.pricePoints, now, 24 * 7),
    sparkline7d: sparklineFromPoints(card.pricePoints, now),
  };
}

/** Чтение карточек для строк списка. Один набор полей на оба вида чтения. */
async function readCardsForList(
  slugs: readonly string[],
  now: Date,
): Promise<CardForList[]> {
  if (slugs.length === 0) return [];
  return prisma.coinCard.findMany({
    where: { slug: { in: [...slugs] }, status: "APPROVED" },
    select: {
      slug: true,
      symbol: true,
      name: true,
      logoUrl: true,
      coinId: true,
      tokenomics: true,
      priceIndex: {
        select: { priceUsd: true, change24h: true, volumeUsd24h: true, computedAt: true },
      },
      supply: { select: { circulating: true, totalSupply: true, checkError: true } },
      pricePoints: {
        where: { at: { gte: new Date(now.getTime() - WEEK_MS) } },
        orderBy: { at: "asc" },
        select: { at: true, priceUsd: true },
      },
    },
  });
}

/**
 * Строки списка для монет, живущих одной карточкой, по их `slug`. Нужны
 * странице закладок: монету, отмеченную звёздочкой в основном списке, закладки
 * обязаны показывать, а рыночного фида у неё нет.
 *
 * Номера списка (`listNo`) у этих строк нет намеренно — номер принадлежит
 * главной, и на странице закладок в столбце стоит «—».
 */
export async function readCardRowsBySlugs(
  slugs: readonly string[],
  now = new Date(),
): Promise<ListRow[]> {
  const cards = await readCardsForList(slugs, now);
  const rows: ListRow[] = [];
  for (const card of cards) {
    const row = buildPinnedRow(card, 0, now);
    if (!row) continue;
    const plain: ListRow = { ...row };
    delete (plain as { position?: number }).position;
    rows.push(plain);
  }
  return rows;
}

/**
 * Закреплённые строки для основного списка. Кэш в Redis на пять минут: главная
 * пересобирается раз в минуту, а числа меняются раз в час.
 */
export async function readPinnedCardRows(now = new Date()): Promise<PinnedListRow[]> {
  if (PINNED_CARD_COINS.length === 0) return [];

  const cached = await redisGetSafe(KEYS.pinnedList);
  if (cached) {
    try {
      const raw = JSON.parse(cached) as (Omit<PinnedListRow, "position"> & { position: number })[];
      return raw;
    } catch {
      // Испорченная запись — читаем базу.
    }
  }

  const slugs = PINNED_CARD_COINS.map((p) => p.slug);
  const cards = await readCardsForList(slugs, now);

  const rows: PinnedListRow[] = [];
  for (const { slug, position } of PINNED_CARD_COINS) {
    const card = cards.find((c) => c.slug === slug);
    if (!card) continue;
    const row = buildPinnedRow(card, position, now);
    if (row) rows.push(row);
  }

  await redisSetSafe(KEYS.pinnedList, JSON.stringify(rows), TTL.pinnedList);
  return rows;
}

async function redisGetSafe(key: string): Promise<string | null> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function redisSetSafe(key: string, value: string, ttl: number): Promise<void> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    await redis.set(key, value, "EX", ttl);
  } catch {
    // Нет Redis — читаем базу каждый раз, это два запроса.
  }
}
