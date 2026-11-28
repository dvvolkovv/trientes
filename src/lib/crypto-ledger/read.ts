/**
 * Чтение книги криптоучёта (слайс CR). Prisma живёт здесь, правила счёта — в
 * `aggregate.ts`, правила ввода — в `rules.ts`, сверка курса — в `rate-check.ts`.
 */
import { prisma } from "@/lib/prisma";
import { readExchangeRates } from "@/lib/snapshot";
import { addressKey } from "@/lib/crypto-ledger/address";
import { nearestPrice, PRICE_WINDOW_MS, type PricePoint, type RateUnchecked } from "@/lib/crypto-ledger/rate-check";
import type { LedgerOp, LedgerReceipt } from "@/lib/crypto-ledger/aggregate";

/** Потолок выборки. Усечение называется вслух (правило BK «no silent caps»). */
export const LEDGER_MAX_ROWS = 2000;

export type SanctionHit = { address: string; asset: string; listedName: string | null; programs: string | null; source: string };

export async function readLedgerReceipts(
  companyId: string,
  range: { from: Date; to: Date },
): Promise<{ receipts: LedgerReceipt[]; truncated: boolean }> {
  const rows = await prisma.sale.findMany({
    where: {
      companyId,
      payment: "CRYPTO",
      createdAt: { gte: range.from, lt: range.to },
    },
    orderBy: { createdAt: "desc" },
    take: LEDGER_MAX_ROWS + 1,
    select: {
      id: true,
      number: true,
      createdAt: true,
      currency: true,
      total: true,
      payCoin: true,
      payRate: true,
      payCoinAmount: true,
      payAddress: true,
      payTxHash: true,
      status: true,
    },
  });
  const truncated = rows.length > LEDGER_MAX_ROWS;
  const receipts = rows.slice(0, LEDGER_MAX_ROWS).map((r) => ({
    saleId: r.id,
    number: r.number,
    at: r.createdAt,
    currency: r.currency,
    total: Number(r.total),
    // Монета обязательна у крипто-чека (`coin_required` в CK), но колонка nullable —
    // честный запасной знак лучше пустой строки на экране.
    coin: (r.payCoin ?? "—").toUpperCase(),
    rate: r.payRate === null ? null : Number(r.payRate),
    coinAmount: r.payCoinAmount === null ? null : Number(r.payCoinAmount),
    address: r.payAddress,
    txHash: r.payTxHash,
    cancelled: r.status === "CANCELLED",
  }));
  return { receipts, truncated };
}

export type LedgerOpWithAuthor = LedgerOp & { authorName: string | null };

export async function readLedgerOps(
  companyId: string,
  range: { from: Date; to: Date },
): Promise<{ ops: LedgerOpWithAuthor[]; truncated: boolean }> {
  const rows = await prisma.companyCryptoOperation.findMany({
    where: { companyId, happenedAt: { gte: range.from, lt: range.to } },
    orderBy: { happenedAt: "desc" },
    take: LEDGER_MAX_ROWS + 1,
    include: { createdBy: { select: { id: true, name: true, username: true } } },
  });
  const truncated = rows.length > LEDGER_MAX_ROWS;
  const ops: LedgerOpWithAuthor[] = rows.slice(0, LEDGER_MAX_ROWS).map((o) => ({
    id: o.id,
    kind: o.kind as LedgerOp["kind"],
    coin: o.coin,
    amount: Number(o.amount),
    rate: o.rate === null ? null : Number(o.rate),
    currency: o.currency,
    fiatAmount: o.fiatAmount === null ? null : Number(o.fiatAmount),
    happenedAt: o.happenedAt,
    address: o.address,
    txHash: o.txHash,
    note: o.note,
    authorName: o.createdBy?.username ?? o.createdBy?.name ?? null,
  }));
  return { ops, truncated };
}

export type LedgerOpRow = Awaited<ReturnType<typeof readLedgerOps>>["ops"][number];

export async function readCryptoAddresses(companyId: string) {
  return prisma.companyCryptoAddress.findMany({
    where: { companyId },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    include: { createdBy: { select: { username: true, name: true } } },
  });
}

/**
 * Санкционные попадания по набору адресов. Сверяем **двумя** ключами — приведённым и
 * сырым: адрес, чью семью мы не знаем, по приведённому ключу не нашёлся бы (разбор 5.4).
 */
export async function readSanctionHits(addresses: readonly string[]): Promise<Map<string, SanctionHit>> {
  const out = new Map<string, SanctionHit>();
  const unique = [...new Set(addresses.filter(Boolean))];
  if (unique.length === 0) return out;

  const keys = [...new Set(unique.flatMap((a) => [addressKey(a), a, a.toLowerCase()]))];
  const rows = await prisma.sanctionedCryptoAddress.findMany({
    where: { addressKey: { in: keys } },
    select: { address: true, addressKey: true, asset: true, listedName: true, programs: true, source: true },
  });
  if (rows.length === 0) return out;

  const byKey = new Map(rows.map((r) => [r.addressKey, r]));
  for (const a of unique) {
    const hit = byKey.get(addressKey(a)) ?? byKey.get(a) ?? byKey.get(a.toLowerCase());
    if (hit) {
      out.set(a, {
        address: hit.address,
        asset: hit.asset,
        listedName: hit.listedName,
        programs: hit.programs,
        source: hit.source,
      });
    }
  }
  return out;
}

export type CoinPrices = {
  points: PricePoint[];
  reason: Extract<RateUnchecked, "coin_unknown" | "ticker_ambiguous" | "no_price"> | null;
};

/**
 * Наши цены монеты в долларах на отрезке. Опорой становится **единственное** совпадение
 * тикера: карточка монеты (её часовой ряд точнее) и только потом каталожная строка.
 * Неоднозначный тикер — отказ, а не выбор первого (правило CJ).
 */
export async function readCoinPrices(
  symbols: readonly string[],
  range: { from: Date; to: Date },
): Promise<Map<string, CoinPrices>> {
  const out = new Map<string, CoinPrices>();
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s && s !== "—"))];
  if (wanted.length === 0) return out;

  const from = new Date(range.from.getTime() - PRICE_WINDOW_MS);
  const to = new Date(range.to.getTime() + PRICE_WINDOW_MS);

  const [cards, coins] = await Promise.all([
    prisma.coinCard.findMany({
      where: { status: "APPROVED", symbol: { in: wanted, mode: "insensitive" } },
      select: { id: true, symbol: true },
    }),
    prisma.coin.findMany({
      where: { symbol: { in: wanted.map((s) => s.toLowerCase()), mode: "insensitive" } },
      select: { id: true, symbol: true },
    }),
  ]);

  for (const symbol of wanted) {
    const cardMatches = cards.filter((c) => c.symbol.toUpperCase() === symbol);
    const coinMatches = coins.filter((c) => c.symbol.toUpperCase() === symbol);

    if (cardMatches.length === 1) {
      const points = await prisma.coinCardPricePoint.findMany({
        where: { cardId: cardMatches[0].id, at: { gte: from, lte: to } },
        select: { at: true, priceUsd: true },
      });
      out.set(symbol, {
        points: points.map((p) => ({ at: p.at, usd: p.priceUsd })),
        reason: points.length ? null : "no_price",
      });
      continue;
    }
    if (cardMatches.length > 1 || coinMatches.length > 1) {
      out.set(symbol, { points: [], reason: "ticker_ambiguous" });
      continue;
    }
    if (coinMatches.length === 1) {
      const snaps = await prisma.coinSnapshot.findMany({
        where: { coinId: coinMatches[0].id, fetchedAt: { gte: from, lte: to } },
        select: { fetchedAt: true, priceUsd: true },
      });
      out.set(symbol, {
        points: snaps.map((s) => ({ at: s.fetchedAt, usd: Number(s.priceUsd) })),
        reason: snaps.length ? null : "no_price",
      });
      continue;
    }
    out.set(symbol, { points: [], reason: "coin_unknown" });
  }

  return out;
}

/**
 * Сколько долларов в одной единице валюты. Курс **сегодняшний**: исторических фиатных
 * курсов мы не храним, и экран говорит это прямо.
 */
export async function readUsdPerUnit(currencies: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rates = await readExchangeRates();
  if (!rates) return out;
  const usd = rates.usd?.value;
  if (!usd) return out;
  for (const currency of new Set(currencies)) {
    if (currency === "USD") {
      out.set(currency, 1);
      continue;
    }
    const target = rates[currency.toLowerCase()]?.value;
    if (!target) continue;
    // `rates` считает единицы валюты за один BTC: доллар в единице валюты — это
    // отношение курсов, то же, что делает `convert()` в `currency.ts`.
    out.set(currency, usd / target);
  }
  return out;
}

export function priceFor(prices: Map<string, CoinPrices>, coin: string, at: Date) {
  const entry = prices.get(coin.toUpperCase());
  if (!entry) return { usd: null, reason: "coin_unknown" as const };
  if (entry.reason) return { usd: null, reason: entry.reason };
  return { usd: nearestPrice(entry.points, at), reason: null };
}
