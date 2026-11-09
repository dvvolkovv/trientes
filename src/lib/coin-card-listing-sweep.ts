/**
 * Конвейер листинга карточек, проверяемых в сети (слайс W).
 *
 * Зачем прогон, если есть `scripts/seed-chain-cards.ts`: скрипт требует
 * человека на каждом из четырёх шагов, а значит новая строка реестра лежит
 * мёртвой до тех пор, пока кто-то не вспомнит про неё. Прогон делает ту же
 * работу раз в сутки и сам: завести монету, завести карточку, открыть ту, где
 * сеть подтвердила всё и не один раз.
 *
 * Чего прогон не делает сознательно: не правит и не скрывает уже открытые
 * карточки (сбой публичного узла не должен гасить страницу), не меняет `trust`,
 * не трогает карточки с куратором или компанией — это чужая заявка, её смотрит
 * админ.
 */

import { resolveBitcoinChain } from "./bitcoin-chains";
import { chainFamily, plannedCard, SEED_CARDS } from "./coin-card-seed";
import { resolveCosmosChain } from "./cosmos-chains";
import { resolveSubstrateChain } from "./substrate-chains";

/** Сколько карточка должна прожить до автопубликации. */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Насколько свежим должно быть чтение сети. */
export const MAX_FACTS_AGE_MS = 3 * 60 * 60 * 1000;

export type PublishCandidate = {
  status: string;
  nativeChain: string | null;
  stewardUserId: string | null;
  companyId: string | null;
  createdAt: Date;
  chainFacts: { checkError: string | null; mismatches: string[]; checkedAt: Date } | null;
  supply: { checkError: string | null } | null;
};

/**
 * Можно ли открыть карточку без человека. Правило сознательно строже ручного
 * `--publish`: решение принимает не глаз, а код, поэтому оно требует суток
 * подтверждений (прогоны фактов и выпуска за это время прочитали сеть не меньше
 * двадцати раз) и полного отсутствия расхождений.
 *
 * Возвращает причину отказа, а не `false`: причина попадает в лог прогона, и по
 * ней видно, сеть молчит или карточка просто молодая.
 */
export function publishBlocker(card: PublishCandidate, now: Date): string | null {
  if (card.status !== "PENDING") return "not_pending";
  if (!card.nativeChain) return "no_chain";
  // Карточка с куратором или компанией — чужая заявка, а не наш посев.
  if (card.stewardUserId || card.companyId) return "has_owner";
  if (now.getTime() - card.createdAt.getTime() < MIN_AGE_MS) return "too_young";
  if (!card.chainFacts) return "no_facts";
  if (card.chainFacts.checkError) return `facts_error:${card.chainFacts.checkError}`;
  if (card.chainFacts.mismatches.length > 0)
    return `mismatch:${card.chainFacts.mismatches.join(",")}`;
  if (now.getTime() - card.chainFacts.checkedAt.getTime() > MAX_FACTS_AGE_MS) return "facts_stale";
  if (!card.supply) return "no_supply";
  // Выпуск, не читаемый по свойству семьи (слайс Y: в UTXO-цепи его доказывает
  // только проход по всему UTXO-множеству, и публичные узлы его не выполняют),
  // препятствием не считается — иначе карточка Bitcoin ждала бы человека
  // вечно. Сбой чтения по-прежнему держит карточку закрытой.
  if (card.supply.checkError && card.supply.checkError !== "supply_unsupported") {
    return `supply_error:${card.supply.checkError}`;
  }
  return null;
}

/** Название и тикер монеты берутся из реестра сети, а не из внешнего источника. */
export function coinFromRegistry(chain: string): { symbol: string; name: string } | null {
  const sub = resolveSubstrateChain(chain);
  if (sub) return { symbol: sub.symbol, name: sub.label };
  const cos = resolveCosmosChain(chain);
  if (cos) return { symbol: cos.symbol, name: cos.label };
  const btc = resolveBitcoinChain(chain);
  if (btc) return { symbol: btc.symbol, name: btc.label };
  return null;
}

type PrismaLike = {
  coin: {
    findUnique: (a: unknown) => Promise<{ id: string; slug: string; name: string; symbol: string } | null>;
    create: (a: unknown) => Promise<unknown>;
  };
  coinCard: {
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
    create: (a: unknown) => Promise<unknown>;
    findMany: (a: unknown) => Promise<Array<PublishCandidate & { id: string; slug: string }>>;
    update: (a: unknown) => Promise<unknown>;
  };
};

export type SweepStats = {
  coinsCreated: number;
  cardsCreated: number;
  published: number;
  held: Record<string, number>;
};

export async function runListingSweep(args: {
  prisma: PrismaLike;
  now?: Date;
}): Promise<SweepStats> {
  const prisma = args.prisma;
  const now = args.now ?? new Date();
  const stats: SweepStats = { coinsCreated: 0, cardsCreated: 0, published: 0, held: {} };

  for (const row of SEED_CARDS) {
    if (!chainFamily(row.chain)) continue;
    let coin = await prisma.coin.findUnique({
      where: { id: row.coinId },
      select: { id: true, slug: true, name: true, symbol: true },
    });
    if (!coin) {
      // Каталог наполняется категорией layer-1 у CoinGecko, и она неполна: ни
      // Polkadot, ни Cosmos Hub в ней нет. Монета заводится из реестра — её id
      // лежит в ревизованном коде, а не приходит из формы. Цену и логотип
      // нальёт существующий прогон admin-added на 5-й и 35-й минуте.
      const meta = coinFromRegistry(row.chain);
      if (!meta) continue;
      await prisma.coin.create({
        data: {
          id: row.coinId,
          slug: row.coinId,
          symbol: meta.symbol,
          name: meta.name,
          rank: 9999,
          source: "ADMIN_ADDED",
          isActive: true,
        },
      });
      stats.coinsCreated++;
      coin = { id: row.coinId, slug: row.coinId, symbol: meta.symbol, name: meta.name };
    }

    const already = await prisma.coinCard.findFirst({
      where: { OR: [{ coinId: coin.id }, { slug: coin.slug }] },
      select: { id: true },
    });
    if (already) continue;
    const card = plannedCard(coin, row.chain, now);
    await prisma.coinCard.create({
      data: {
        slug: card.slug,
        coinId: card.coinId,
        name: card.name,
        symbol: card.symbol,
        nativeChain: card.nativeChain,
        status: card.status,
        trust: card.trust,
        provenance: card.provenance,
      },
    });
    stats.cardsCreated++;
  }

  const candidates = await prisma.coinCard.findMany({
    where: { status: "PENDING", nativeChain: { not: null } },
    select: {
      id: true,
      slug: true,
      status: true,
      nativeChain: true,
      stewardUserId: true,
      companyId: true,
      createdAt: true,
      chainFacts: { select: { checkError: true, mismatches: true, checkedAt: true } },
      supply: { select: { checkError: true } },
    },
  });
  for (const card of candidates) {
    const blocker = publishBlocker(card, now);
    if (blocker) {
      stats.held[blocker] = (stats.held[blocker] ?? 0) + 1;
      continue;
    }
    await prisma.coinCard.update({ where: { id: card.id }, data: { status: "APPROVED" } });
    stats.published++;
  }
  return stats;
}
