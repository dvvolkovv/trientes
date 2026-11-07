/**
 * Слайс E: циркулирующий выпуск как вычитание, а не как слово проекта.
 *
 * `totalSupply()` канонического контракта минус балансы адресов, которые по
 * заявлению проекта не в обороте (казна, фонд, вестинг, сжигание). Каждое
 * слагаемое сохраняется с адресом и балансом — расчёт читатель может повторить
 * руками в эксплорере.
 *
 * Правило слайса B остаётся в силе: заявление проекта в `tokenomics` не
 * правится. Факт сети живёт в `CoinCardSupply`, расхождение показывается рядом.
 */

import { SELECTORS, decodeUint, encodeAddressArg, isEvmAddress, normalizeAddress } from "./evm-abi";
import { resolveEvmChain, rpcUrlFor } from "./evm-chains";
import { ethCall, RpcError, type FetchLike } from "./evm-rpc";
import { mergeProvenance } from "./coin-card-provenance";

/** Канонические адреса сжигания: сожжённое оборотом не считает никто. */
export const BURN_ADDRESSES: readonly string[] = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
];

/** Больше адресов на карточку не читаем: публичные узлы не для обстрела. */
export const MAX_EXCLUDED = 20;

/** Знаков после точки в хранимых строках выпуска. */
export const COIN_SCALE = 6;

/** Проект целится в ES2017, где литерала `0n` нет. */
const ZERO = BigInt(0);

export type ExcludedInput = { address: string; label: string | null };

export type BalanceRow = {
  address: string;
  label: string | null;
  /** Баланс в минимальных единицах; null — адрес не ответил. */
  units: string | null;
  error: string | null;
};

export type ExcludedRow = {
  address: string;
  label: string | null;
  /** Баланс в монетах; null — адрес не ответил. */
  balance: string | null;
  error: string | null;
};

export type SupplyResult = {
  total: string;
  excludedTotal: string;
  circulating: string;
  partial: boolean;
  excluded: ExcludedRow[];
};

/* ─── чистые функции ─────────────────────────────────────────────────────── */

/**
 * Минимальные единицы → монеты строкой. `number` здесь непригоден: uint256 с
 * 18 знаками не влезает в двойную точность, а выпуск — то самое число, по
 * которому считают капитализацию. Дробный хвост **обрезается**, а не
 * округляется: выпуск нельзя завышать даже в седьмом знаке.
 */
export function unitsToCoins(units: string, decimals: number): string | null {
  if (typeof units !== "string" || !/^\d+$/.test(units)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  if (decimals === 0) return String(BigInt(units));

  const padded = units.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).slice(0, COIN_SCALE).replace(/0+$/, "");
  const head = String(BigInt(whole));
  return frac ? `${head}.${frac}` : head;
}

/** Монеты строкой → минимальные единицы той же шкалы COIN_SCALE. */
function coinsToScaled(coins: string): bigint | null {
  if (typeof coins !== "string" || !/^\d+(\.\d+)?$/.test(coins.trim())) return null;
  const [whole, frac = ""] = coins.trim().split(".");
  return BigInt(whole + frac.padEnd(COIN_SCALE, "0").slice(0, COIN_SCALE));
}

function scaledToCoins(scaled: bigint): string {
  const sign = scaled < ZERO ? "-" : "";
  const digits = (scaled < ZERO ? -scaled : scaled).toString().padStart(COIN_SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - COIN_SCALE);
  const frac = digits.slice(digits.length - COIN_SCALE).replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** Строка выпуска → `number` для показа и умножения на цену. */
export function coinsToNumber(coins: string | null | undefined): number | null {
  if (typeof coins !== "string" || !/^\d+(\.\d+)?$/.test(coins.trim())) return null;
  const n = Number(coins);
  return Number.isFinite(n) ? n : null;
}

type TokenomicsLike = {
  excluded?: unknown;
  excludedAddresses?: unknown;
};

/**
 * Список адресов исключений из токеномики. Читаются оба вида: новые строки
 * `{address,label}` и старый список строк `excludedAddresses` (его писала форма
 * слайса A, и переписывать чужие данные под новую форму незачем).
 */
export function parseExcluded(tokenomics: unknown): ExcludedInput[] {
  const t = (tokenomics ?? {}) as TokenomicsLike;
  const out: ExcludedInput[] = [];
  const seen = new Set<string>();

  const add = (rawAddress: unknown, rawLabel: unknown) => {
    if (typeof rawAddress !== "string" || !isEvmAddress(rawAddress)) return;
    const address = normalizeAddress(rawAddress);
    if (seen.has(address)) return;
    seen.add(address);
    const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : null;
    out.push({ address, label });
  };

  if (Array.isArray(t.excluded)) {
    for (const row of t.excluded) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      add(r.address, r.label);
    }
  }
  if (Array.isArray(t.excludedAddresses)) {
    for (const row of t.excludedAddresses) add(row, null);
  }
  for (const burn of BURN_ADDRESSES) add(burn, "burn");

  return out.slice(0, MAX_EXCLUDED);
}

/**
 * Собственно расчёт. Оборот зажимается в ноль: исключения больше выпуска —
 * это ошибка в списке адресов проекта, а не отрицательное число монет.
 * Адрес, который не ответил, в сумму не входит и поднимает `partial` —
 * недоступный узел не должен выглядеть как «на этом адресе ноль».
 */
export function computeSupply(args: {
  totalUnits: string;
  decimals: number;
  balances: readonly BalanceRow[];
}): SupplyResult {
  const total = unitsToCoins(args.totalUnits, args.decimals) ?? "0";
  let excludedScaled = ZERO;
  let partial = false;
  const excluded: ExcludedRow[] = [];

  for (const row of args.balances) {
    if (row.units == null || row.error) {
      partial = true;
      excluded.push({ address: row.address, label: row.label, balance: null, error: row.error });
      continue;
    }
    const balance = unitsToCoins(row.units, args.decimals);
    if (balance == null) {
      partial = true;
      excluded.push({ address: row.address, label: row.label, balance: null, error: "decode_failed" });
      continue;
    }
    excludedScaled += coinsToScaled(balance) ?? ZERO;
    excluded.push({ address: row.address, label: row.label, balance, error: null });
  }

  const totalScaled = coinsToScaled(total) ?? ZERO;
  const circulatingScaled = totalScaled > excludedScaled ? totalScaled - excludedScaled : ZERO;

  return {
    total,
    excludedTotal: scaledToCoins(excludedScaled),
    circulating: scaledToCoins(circulatingScaled),
    partial,
    excluded,
  };
}

/** На сколько процентов заявление проекта расходится с расчётом. */
export function claimedDeltaPct(
  claimed: number | null | undefined,
  circulating: string,
): number | null {
  const fact = coinsToNumber(circulating);
  if (claimed == null || !Number.isFinite(claimed) || fact == null || fact === 0) return null;
  return ((claimed - fact) / fact) * 100;
}

export function marketCap(
  priceUsd: number | null | undefined,
  circulating: string | null | undefined,
): number | null {
  const supply = coinsToNumber(circulating);
  if (priceUsd == null || !Number.isFinite(priceUsd) || supply == null) return null;
  const cap = priceUsd * supply;
  return Number.isFinite(cap) ? cap : null;
}

/** Полная разводнённая оценка: та же математика, но по максимальному выпуску. */
export function fdv(
  priceUsd: number | null | undefined,
  maxOrTotal: string | null | undefined,
): number | null {
  return marketCap(priceUsd, maxOrTotal);
}

/* ─── чтение из сети ─────────────────────────────────────────────────────── */

export type SupplyReadError = "chain_unsupported" | "address_invalid" | "supply_unreadable";

export type SupplyFacts = {
  totalUnits: string | null;
  balances: BalanceRow[];
  error: SupplyReadError | null;
};

function rpcErrorCode(err: unknown): string {
  return err instanceof RpcError ? err.code : "rpc_error";
}

/**
 * `totalSupply()` плюс по одному `balanceOf` на адрес исключения. Ошибка
 * общего выпуска фатальна — без него считать нечего; ошибка отдельного адреса
 * локальна и переживается как `partial`.
 */
export async function readSupplyFacts(args: {
  chain: string;
  address: string;
  excluded: readonly ExcludedInput[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SupplyFacts> {
  const chain = resolveEvmChain(args.chain);
  if (!chain) return { totalUnits: null, balances: [], error: "chain_unsupported" };
  if (!isEvmAddress(args.address)) {
    return { totalUnits: null, balances: [], error: "address_invalid" };
  }

  const url = rpcUrlFor(chain);
  const token = normalizeAddress(args.address);
  const opts = { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs };

  let totalUnits: string;
  try {
    const raw = await ethCall(url, token, SELECTORS.totalSupply, opts);
    totalUnits = decodeUint(raw).toString();
  } catch {
    return { totalUnits: null, balances: [], error: "supply_unreadable" };
  }

  const balances: BalanceRow[] = [];
  for (const row of args.excluded.slice(0, MAX_EXCLUDED)) {
    try {
      const raw = await ethCall(
        url,
        token,
        SELECTORS.balanceOf + encodeAddressArg(row.address),
        opts,
      );
      balances.push({ ...row, units: decodeUint(raw).toString(), error: null });
    } catch (err) {
      balances.push({ ...row, units: null, error: rpcErrorCode(err) });
    }
  }

  return { totalUnits, balances, error: null };
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

type ContractRow = { chain: string; address: string; decimals: number | null; onchainDecimals: number | null };

type CardRow = {
  id: string;
  tokenomics: unknown;
  provenance: unknown;
  contracts: ContractRow[];
  supply: { checkedAt: Date } | null;
};

export type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<CardRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCardSupply: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export type SupplySyncStats = {
  cards: number;
  ok: number;
  partial: number;
  failed: number;
};

/**
 * Прогон по карточкам: только там, где есть канонический контракт, уже
 * сверенный слайсом B. Без сверки `totalSupply()` ничего не стоит — подделка с
 * тем же тикером ответит на него что угодно.
 */
export async function syncCardSupply(args: {
  prisma: PrismaLike;
  fetchImpl?: FetchLike;
  cardId?: string;
  limit?: number;
  now?: Date;
}): Promise<SupplySyncStats> {
  const { prisma, fetchImpl, cardId } = args;
  const now = args.now ?? new Date();
  const limit = args.limit ?? 50;

  const baseWhere = cardId
    ? { id: cardId }
    : {
        status: "APPROVED",
        contracts: { some: { isCanonical: true, verifiedAt: { not: null } } },
      };
  const select = {
    id: true,
    tokenomics: true,
    provenance: true,
    contracts: {
      where: { isCanonical: true, verifiedAt: { not: null } },
      select: { chain: true, address: true, decimals: true, onchainDecimals: true },
      take: 1,
    },
    supply: { select: { checkedAt: true } },
  };

  // Два запроса, а не один с сортировкой по связи: в Postgres `ORDER BY ... ASC`
  // ставит NULL в конец, то есть никогда не проверенная карточка оказалась бы
  // позади пятидесяти уже проверенных. `nulls: "first"` на поле связи Prisma 5
  // не принимает, поэтому очередь собирается явно.
  const never = await prisma.coinCard.findMany({
    where: { ...baseWhere, supply: { is: null } },
    take: limit,
    select,
  });
  const stale =
    never.length >= limit
      ? []
      : await prisma.coinCard.findMany({
          where: { ...baseWhere, supply: { isNot: null } },
          orderBy: [{ supply: { checkedAt: "asc" } }],
          take: limit - never.length,
          select,
        });
  const cards = [...never, ...stale];

  const stats: SupplySyncStats = { cards: 0, ok: 0, partial: 0, failed: 0 };

  for (const card of cards) {
    const contract = card.contracts[0];
    if (!contract) continue;
    const decimals = contract.onchainDecimals ?? contract.decimals;
    stats.cards++;

    if (decimals == null) {
      stats.failed++;
      await writeSupply({
        prisma,
        cardId: card.id,
        data: {
          chain: contract.chain,
          address: contract.address,
          decimals: 0,
          totalSupply: "0",
          excludedTotal: "0",
          circulating: "0",
          excluded: [],
          partial: true,
          claimedDeltaPct: null,
          checkedAt: now,
          checkError: "decimals_unknown",
        },
      });
      continue;
    }

    const excluded = parseExcluded(card.tokenomics);
    const facts = await readSupplyFacts({
      chain: contract.chain,
      address: contract.address,
      excluded,
      fetchImpl,
    });

    if (facts.error || facts.totalUnits == null) {
      stats.failed++;
      await writeSupply({
        prisma,
        cardId: card.id,
        data: { chain: contract.chain, address: contract.address, decimals, checkedAt: now, checkError: facts.error ?? "supply_unreadable" },
        // Прошлые числа не стираются: недоступный узел — не новость о монете.
        createDefaults: true,
      });
      continue;
    }

    const result = computeSupply({ totalUnits: facts.totalUnits, decimals, balances: facts.balances });
    const claimed = (card.tokenomics as { circulating?: number | null } | null)?.circulating ?? null;

    await writeSupply({
      prisma,
      cardId: card.id,
      data: {
        chain: contract.chain,
        address: contract.address,
        decimals,
        totalSupply: result.total,
        excludedTotal: result.excludedTotal,
        circulating: result.circulating,
        excluded: result.excluded,
        partial: result.partial,
        claimedDeltaPct: claimedDeltaPct(claimed, result.circulating),
        checkedAt: now,
        checkError: null,
      },
    });

    await prisma.coinCard.update({
      where: { id: card.id },
      data: {
        provenance: mergeProvenance(card.provenance, {
          "supply.circulating": {
            kind: "VERIFIED_ONCHAIN",
            source: contract.chain,
            at: now.toISOString(),
          },
        }) as never,
      },
    });

    if (result.partial) stats.partial++;
    else stats.ok++;
  }

  return stats;
}

async function writeSupply(args: {
  prisma: PrismaLike;
  cardId: string;
  data: Record<string, unknown>;
  createDefaults?: boolean;
}): Promise<void> {
  const { prisma, cardId, data } = args;
  const create = args.createDefaults
    ? { totalSupply: "0", excludedTotal: "0", circulating: "0", excluded: [], partial: true, ...data }
    : data;
  await prisma.coinCardSupply.upsert({
    where: { cardId },
    update: data,
    create: { cardId, ...create },
  });
}
