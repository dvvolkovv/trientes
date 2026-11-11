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

import { resolveBitcoinChain } from "./bitcoin-chains";
import { DecodeError, SELECTORS, decodeUint, encodeAddressArg, isEvmAddress, normalizeAddress } from "./evm-abi";
import { resolveEvmChain, rpcUrlFor } from "./evm-chains";
import { ethCall, RpcError, type FetchLike, type RpcErrorCode } from "./evm-rpc";
import { mergeProvenance } from "./coin-card-provenance";
import {
  resolveSubstrateChain,
  substrateIssuanceUrlFor,
  substrateRpcUrlFor,
} from "./substrate-chains";
import { isSs58Address } from "./substrate-codec";
import { readVestingLocked, VESTING_STORAGE } from "./substrate-vesting";
import { resolveCosmosChain, cosmosRestUrlFor } from "./cosmos-chains";
import { readCosmosBlock, readCosmosSupply, type HttpFetch } from "./cosmos-rest";
import {
  readAccountBalance,
  readChainProperties,
  readGenesisHash,
  readTotalIssuance,
} from "./substrate-rpc";

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

/** Как проверять и приводить адрес: у EVM и Substrate это разные правила. */
export type AddressRules = {
  accept: (address: string) => boolean;
  normalize: (address: string) => string;
};

const EVM_RULES: AddressRules = { accept: isEvmAddress, normalize: normalizeAddress };

/**
 * Список адресов исключений из токеномики. Читаются оба вида: новые строки
 * `{address,label}` и старый список строк `excludedAddresses` (его писала форма
 * слайса A, и переписывать чужие данные под новую форму незачем).
 *
 * Правила адреса передаются снаружи: в Substrate-сети EVM-адрес не адрес вовсе,
 * а канонические адреса сжигания не существуют — оба отсекаются валидатором, и
 * отдельной ветки в расчёте для этого не нужно.
 */
export function parseExcluded(
  tokenomics: unknown,
  rules: AddressRules = EVM_RULES,
): ExcludedInput[] {
  const t = (tokenomics ?? {}) as TokenomicsLike;
  const out: ExcludedInput[] = [];
  const seen = new Set<string>();

  const add = (rawAddress: unknown, rawLabel: unknown) => {
    if (typeof rawAddress !== "string" || !rules.accept(rawAddress)) return;
    const address = rules.normalize(rawAddress);
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
/**
 * Ниже этой доли прочитанное число перестаёт быть выпуском монеты. Порог грубый
 * сознательно: он ловит переезд балансов и мост (разница в разы), а не
 * расхождение методик подсчёта (разница в проценты — для неё `claimedDeltaPct`).
 */
export const SUPPLY_SHARE_MIN = 0.5;

/**
 * Какую часть известного выпуска монеты мы прочитали в этой сети.
 *
 * Нужна потому, что домашняя сеть монеты не всегда держит саму монету: у
 * Polkadot балансы переехали в Asset Hub, у MANTRA основная масса живёт за
 * пределами `mantra-1`. В обоих случаях `TotalIssuance` отвечает честно — но
 * про остаток, а не про монету. Сравнение со снимком агрегатора это видит.
 */
export function supplyShare(
  readCoins: string | null | undefined,
  aggregated: number | null | undefined,
): number | null {
  if (!readCoins || aggregated == null || !(aggregated > 0)) return null;
  const read = coinsToNumber(readCoins);
  if (read == null) return null;
  return read / aggregated;
}

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

/**
 * Почему выпуск не прочитан. Коды транспорта (`rpc_unreachable`, `rpc_error`,
 * `decode_failed`) попадают сюда как есть: сбой связи с публичным узлом, отказ
 * самого узла и ответ без значения — три разные новости, и ночной отчёт
 * здоровья обязан их различать. `supply_unreadable` остался как последнее
 * слово для сбоя не из транспорта.
 */
export type SupplyReadError =
  | "chain_unsupported"
  | "address_invalid"
  | "supply_unreadable"
  /**
   * Выпуск прочитан, а заморозка — нет. Отдельный код, потому что новость
   * другая: числа есть, но оборот по ним посчитался бы без вычета, то есть
   * завышенным. Такую карточку лучше оставить с прежними числами.
   */
  | "vesting_unreadable"
  | RpcErrorCode;

export type SupplyFacts = {
  totalUnits: string | null;
  balances: BalanceRow[];
  error: SupplyReadError | null;
};

function rpcErrorCode(err: unknown): string {
  return err instanceof RpcError ? err.code : "rpc_error";
}

/**
 * Код сбоя чтения выпуска: от узла — его собственный, от декодера — его же
 * слово (в EVM расшифровка живёт вне транспорта, в Substrate внутри, а причина
 * одна и та же), иначе общее слово.
 */
function supplyReadError(err: unknown): SupplyReadError {
  if (err instanceof RpcError) return err.code;
  if (err instanceof DecodeError) return "decode_failed";
  return "supply_unreadable";
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
  } catch (err) {
    return { totalUnits: null, balances: [], error: supplyReadError(err) };
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

export type SubstrateSupplyFacts = SupplyFacts & {
  decimals: number | null;
  symbol: string | null;
  genesisHash: string | null;
};

/**
 * Выпуск нативной монеты: общий выпуск из `Balances.TotalIssuance` и по одному
 * чтению `System.Account` на адрес исключения. Как и в EVM-ветке, сбой общего
 * выпуска фатален, сбой отдельного адреса переживается как `partial`.
 *
 * Знаки после точки берутся из `system_properties`, а не со слов проекта: от
 * них зависит порядок величины выпуска, то есть и капитализация.
 */
export async function readSubstrateSupplyFacts(args: {
  chain: string;
  excluded: readonly ExcludedInput[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SubstrateSupplyFacts> {
  const empty = {
    totalUnits: null,
    balances: [] as BalanceRow[],
    decimals: null,
    symbol: null,
    genesisHash: null,
  };
  const chain = resolveSubstrateChain(args.chain);
  if (!chain) return { ...empty, error: "chain_unsupported" };

  const url = substrateRpcUrlFor(chain);
  const opts = { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs };

  let decimals: number | null;
  let symbol: string | null;
  let prefix: number | null;
  let genesisHash: string;
  let totalUnits: string;
  try {
    const props = await readChainProperties(url, opts);
    decimals = props.decimals;
    symbol = props.symbol;
    prefix = props.ss58Format ?? chain.ss58Format;
    genesisHash = await readGenesisHash(url, opts);
    // Выпуск — с того узла, где он настоящий: у сети с переехавшими балансами
    // это не тот же адрес, что для всего остального.
    totalUnits = (await readTotalIssuance(substrateIssuanceUrlFor(chain), opts)).toString();
  } catch (err) {
    return { ...empty, error: supplyReadError(err) };
  }

  const balances: BalanceRow[] = [];
  for (const row of args.excluded.slice(0, MAX_EXCLUDED)) {
    try {
      const units = await readAccountBalance(url, row.address, prefix, opts);
      balances.push({ ...row, units: units.toString(), error: null });
    } catch (err) {
      balances.push({ ...row, units: null, error: rpcErrorCode(err) });
    }
  }

  // Заморозка вестингом — такое же исключение, только адрес ему не нужен:
  // сумма снимается со всей карты расписаний. Сбой здесь не местный, как у
  // одного адреса: без вычета оборот вышел бы завышенным, поэтому чтение
  // срывается целиком и прежние числа карточки остаются на месте.
  if (chain.vestingLocked) {
    try {
      const locked = await readVestingLocked(url, opts);
      balances.push({
        address: VESTING_STORAGE,
        label: `vesting · ${locked.accounts}`,
        units: locked.units.toString(),
        error: null,
      });
    } catch (err) {
      const transport = err instanceof RpcError && err.code !== "decode_failed" ? err.code : null;
      return {
        ...empty,
        decimals,
        symbol,
        genesisHash,
        error: transport ?? "vesting_unreadable",
      };
    }
  }

  return { totalUnits, balances, decimals, symbol, genesisHash, error: null };
}

/**
 * Выпуск в сети на Cosmos SDK. Исключений у посеянной карточки нет: адреса
 * казны может назвать только проект, а он здесь ничего не заявлял, — поэтому
 * оборот равен общему выпуску, и в карточке это подписано провенансом.
 *
 * Знаки берутся из реестра, а не из реестра денома узла: от них зависит
 * порядок величины, и терять выпуск целиком из-за того, что сеть не публикует
 * метаданные денома (Injective, Kava, Secret), неправильно. Расхождение
 * реестра с метаданными ловит сверка фактов сети кодом `DECIMALS`.
 */
export async function readCosmosSupplyFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{
  totalUnits: string | null;
  decimals: number | null;
  symbol: string | null;
  chainId: string | null;
  error: SupplyReadError | null;
}> {
  const empty = { totalUnits: null, decimals: null, symbol: null, chainId: null };
  const chain = resolveCosmosChain(args.chain);
  if (!chain) return { ...empty, error: "chain_unsupported" };

  const url = cosmosRestUrlFor(chain);
  const opts = { fetchImpl: args.fetchImpl as unknown as HttpFetch, timeoutMs: args.timeoutMs };
  try {
    const block = await readCosmosBlock(url, "latest", opts);
    const units = await readCosmosSupply(url, chain.denom, opts);
    return {
      totalUnits: units.toString(),
      decimals: chain.exponent,
      symbol: chain.symbol,
      chainId: block.chainId,
      error: null,
    };
  } catch (err) {
    return { ...empty, error: supplyReadError(err) };
  }
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

type ContractRow = { chain: string; address: string; decimals: number | null; onchainDecimals: number | null };

type CardRow = {
  id: string;
  coinId?: string | null;
  nativeChain: string | null;
  tokenomics: unknown;
  provenance: unknown;
  contracts: ContractRow[];
  supply: { checkedAt: Date } | null;
};

type SnapshotRow = { totalSupply: unknown; circulatingSupply: unknown } | null;

export type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<CardRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCardSupply: {
    upsert(args: unknown): Promise<unknown>;
  };
  /**
   * Нужен только охраннику доли: у карточки без `coinId` сравнивать не с чем, и
   * тогда снимок не запрашивается вовсе.
   */
  coinSnapshot?: {
    findFirst(args: unknown): Promise<SnapshotRow>;
  };
};

export type SupplySyncStats = {
  cards: number;
  ok: number;
  partial: number;
  failed: number;
  /**
   * Карточки, у которых выпуск не читается по свойству семьи, а не из-за сбоя
   * (слайс Y: в UTXO-цепи его доказывает только проход по всему
   * UTXO-множеству, и публичные узлы его не выполняют). Отдельно от `failed`:
   * иначе лог прогона каждый час сообщал бы о сбоях, которых нет.
   */
  unsupported: number;
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
        // Либо токен с уже сверенным контрактом (слайс B), либо нативная
        // монета своей сети — у неё контракта нет и сверять нечего.
        OR: [
          { contracts: { some: { isCanonical: true, verifiedAt: { not: null } } } },
          { nativeChain: { not: null } },
        ],
      };
  const select = {
    id: true,
    coinId: true,
    nativeChain: true,
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

  const stats: SupplySyncStats = { cards: 0, ok: 0, partial: 0, failed: 0, unsupported: 0 };

  for (const card of cards) {
    // Нативная монета своей сети: контракта нет, читаем саму цепь.
    if (card.nativeChain) {
      stats.cards++;
      await syncNativeChainCard({ prisma, card, now, fetchImpl, stats });
      continue;
    }

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

/**
 * Один проход по нативной монете. Вынесено из `syncCardSupply`: EVM-ветка там
 * и без этого на сотню строк, а два расчёта в одном цикле читать нельзя.
 */
async function syncNativeChainCard(args: {
  prisma: PrismaLike;
  card: CardRow;
  now: Date;
  fetchImpl?: FetchLike;
  stats: SupplySyncStats;
}): Promise<void> {
  const { prisma, card, now, fetchImpl, stats } = args;
  const chainKey = card.nativeChain ?? "";
  if (resolveCosmosChain(chainKey)) {
    await syncCosmosCard(args);
    return;
  }
  if (resolveBitcoinChain(chainKey)) {
    await syncBitcoinCard(args);
    return;
  }
  // Нативная монета сети EVM: контракта у неё нет, а значит нет и
  // `totalSupply()`. Узел знает балансы адресов, но не сумму по всем — её не
  // считает никто. Отличие от семьи Bitcoin только в причине: там вызов есть,
  // но публичные узлы его не выполняют, здесь вызова нет вовсе.
  if (resolveEvmChain(chainKey)) {
    await syncEvmNativeCard(args);
    return;
  }
  const chain = resolveSubstrateChain(chainKey);

  if (!chain) {
    stats.failed++;
    await writeSupply({
      prisma,
      cardId: card.id,
      data: {
        chain: chainKey,
        address: "",
        decimals: 0,
        method: "SUBSTRATE_V1",
        checkedAt: now,
        checkError: "chain_unsupported",
      },
      createDefaults: true,
    });
    return;
  }

  // Адреса исключений в этой сети — SS58 своего префикса. EVM-адреса и
  // канонические адреса сжигания отсекаются здесь же: в Substrate их нет.
  const excluded = parseExcluded(card.tokenomics, {
    accept: (a) => isSs58Address(a, chain.ss58Format ?? undefined),
    normalize: (a) => a.trim(),
  });
  const facts = await readSubstrateSupplyFacts({ chain: chain.key, excluded, fetchImpl });

  if (facts.error || facts.totalUnits == null || facts.decimals == null) {
    stats.failed++;
    await writeSupply({
      prisma,
      cardId: card.id,
      data: {
        chain: chain.key,
        // Знаки и хэш генезиса пишутся только когда прочитаны: сорванное
        // чтение не должно обнулять то, что сеть уже подтвердила, — с знаками
        // уходит порядок величины выпуска, а с генезисом идентичность сети.
        ...(facts.genesisHash ? { address: facts.genesisHash } : {}),
        ...(facts.decimals == null ? {} : { decimals: facts.decimals }),
        method: "SUBSTRATE_V1",
        checkedAt: now,
        checkError:
          facts.error ?? (facts.decimals == null ? "decimals_unknown" : "supply_unreadable"),
      },
      // Прошлые числа не стираются: недоступный узел — не новость о монете.
      createDefaults: true,
    });
    return;
  }

  const result = computeSupply({
    totalUnits: facts.totalUnits,
    decimals: facts.decimals,
    balances: facts.balances,
  });
  const claimed = (card.tokenomics as { circulating?: number | null } | null)?.circulating ?? null;

  // Прочитанный выпуск относится к прочитанной сети, а не к монете: если в этой
  // сети лежит малая часть монеты, число сохраняется как факт сети, но выпуском
  // монеты не называется и провенанс на него не ставится.
  const share = supplyShare(result.total, await aggregatedSupply(prisma, card.coinId));
  const understated = share != null && share < SUPPLY_SHARE_MIN;

  await writeSupply({
    prisma,
    cardId: card.id,
    data: {
      chain: chain.key,
      address: facts.genesisHash ?? "",
      decimals: facts.decimals,
      method: "SUBSTRATE_V1",
      totalSupply: result.total,
      excludedTotal: result.excludedTotal,
      circulating: result.circulating,
      excluded: result.excluded,
      partial: result.partial,
      claimedDeltaPct: claimedDeltaPct(claimed, result.circulating),
      checkedAt: now,
      checkError: understated ? "supply_share" : null,
    },
  });

  if (understated) {
    stats.failed++;
    return;
  }

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      provenance: mergeProvenance(card.provenance, {
        "supply.circulating": {
          kind: "VERIFIED_ONCHAIN",
          source: chain.key,
          at: now.toISOString(),
        },
      }) as never,
    },
  });

  if (result.partial) stats.partial++;
  else stats.ok++;
}

/**
 * Выпуск монеты по последнему снимку агрегатора — единственное независимое
 * число, с которым можно сравнить прочитанное. Общий выпуск предпочитается
 * обороту: сравниваем общее с общим.
 */
/**
 * Во сколько раз общий выпуск у агрегатора должен превысить оборот, чтобы счесть
 * его дефектом фида. Живой случай: у Neutron CoinGecko отдаёт
 * `total_supply = 6,2e27` при обороте 369 млн — это база в минимальных единицах,
 * попавшая в поле монет.
 */
export const AGGREGATE_ABSURD_RATIO = 1000;

/**
 * Какое число агрегатора считать известным выпуском монеты. Общий выпуск
 * предпочтительнее оборота, но абсурдное число хуже отсутствующего: сравнение с
 * ним объявило бы прочитанную сеть «малой частью монеты» и скрыло бы верный
 * факт.
 */
export function pickAggregated(
  total: number | null | undefined,
  circulating: number | null | undefined,
): number | null {
  const t = total != null && Number.isFinite(total) && total > 0 ? total : null;
  const c =
    circulating != null && Number.isFinite(circulating) && circulating > 0 ? circulating : null;
  if (t != null && c != null && t > c * AGGREGATE_ABSURD_RATIO) return c;
  return t ?? c;
}

async function aggregatedSupply(
  prisma: PrismaLike,
  coinId: string | null | undefined,
): Promise<number | null> {
  if (!coinId || !prisma.coinSnapshot) return null;
  const snap = await prisma.coinSnapshot.findFirst({
    where: { coinId },
    orderBy: { fetchedAt: "desc" },
    select: { totalSupply: true, circulatingSupply: true },
  });
  if (!snap) return null;
  // Decimal у Prisma — объект; Number() работает и на нём, и на строке.
  const num = (v: unknown): number | null => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return pickAggregated(num(snap.totalSupply), num(snap.circulatingSupply));
}

/**
 * Один проход по нативной монете сети Cosmos. Отдельно от Substrate-ветки по
 * той же причине, по которой та отделена от EVM: читаются разные вещи, и два
 * расчёта в одном теле не читаются.
 */
async function syncCosmosCard(args: {
  prisma: PrismaLike;
  card: CardRow;
  now: Date;
  fetchImpl?: FetchLike;
  stats: SupplySyncStats;
}): Promise<void> {
  const { prisma, card, now, fetchImpl, stats } = args;
  const chain = resolveCosmosChain(card.nativeChain ?? "")!;
  const facts = await readCosmosSupplyFacts({ chain: chain.key, fetchImpl });

  if (facts.error || facts.totalUnits == null || facts.decimals == null) {
    stats.failed++;
    await writeSupply({
      prisma,
      cardId: card.id,
      data: {
        chain: chain.key,
        address: facts.chainId ?? chain.chainId,
        ...(facts.decimals == null ? {} : { decimals: facts.decimals }),
        method: "COSMOS_V1",
        checkedAt: now,
        checkError: facts.error ?? "supply_unreadable",
      },
      // Прошлые числа не стираются: недоступный узел — не новость о монете.
      createDefaults: true,
    });
    return;
  }

  // Исключений нет: назвать адреса казны может только проект, а он на
  // посеянной карточке ничего не заявлял. Оборот равен общему выпуску.
  const result = computeSupply({
    totalUnits: facts.totalUnits,
    decimals: facts.decimals,
    balances: [],
  });
  const claimed = (card.tokenomics as { circulating?: number | null } | null)?.circulating ?? null;
  const share = supplyShare(result.total, await aggregatedSupply(prisma, card.coinId));
  const understated = share != null && share < SUPPLY_SHARE_MIN;

  await writeSupply({
    prisma,
    cardId: card.id,
    data: {
      chain: chain.key,
      address: facts.chainId ?? chain.chainId,
      decimals: facts.decimals,
      method: "COSMOS_V1",
      totalSupply: result.total,
      excludedTotal: result.excludedTotal,
      circulating: result.circulating,
      excluded: result.excluded,
      partial: result.partial,
      claimedDeltaPct: claimedDeltaPct(claimed, result.circulating),
      checkedAt: now,
      checkError: understated ? "supply_share" : null,
    },
  });

  if (understated) {
    stats.failed++;
    return;
  }

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      provenance: mergeProvenance(card.provenance, {
        "supply.circulating": {
          kind: "VERIFIED_ONCHAIN",
          source: chain.key,
          at: now.toISOString(),
        },
      }) as never,
    },
  });
  stats.ok++;
}

/**
 * Один проход по нативной монете семьи Bitcoin (слайс Y). Сети здесь не
 * касаемся вовсе: выпуск в UTXO-цепи доказывает только `gettxoutsetinfo` —
 * сумма всего UTXO-множества, — а публичные узлы этот вызов не выполняют
 * (живая проверка 9 ноября: полная нода обрывает запрос через 30 секунд).
 *
 * Записываем это состояние, а не оставляем пустоту: `supply_unsupported` —
 * признанный факт о семье, по которому конвейер листинга вправе открыть
 * карточку, тогда как отсутствие строки означало бы «ещё не читали».
 *
 * Чего здесь сознательно нет: выпуска по расписанию эмиссии. Высота цепи
 * известна, субсидия halving-эпох известна, но это наше вычисление, а не факт
 * сети, и у Dogecoin оно просто неверно — до блока 600 000 награда была
 * случайной.
 */
async function syncBitcoinCard(args: {
  prisma: PrismaLike;
  card: CardRow;
  now: Date;
  stats: SupplySyncStats;
}): Promise<void> {
  const { prisma, card, now, stats } = args;
  const chain = resolveBitcoinChain(card.nativeChain ?? "")!;
  await writeSupply({
    prisma,
    cardId: card.id,
    data: {
      chain: chain.key,
      address: chain.genesisHash,
      decimals: chain.decimals,
      method: "BITCOIN_V1",
      checkedAt: now,
      checkError: "supply_unsupported",
    },
    createDefaults: true,
  });
  stats.unsupported++;
}

/**
 * Один проход по нативной монете сети EVM (слайс Z). Как и в семье Bitcoin,
 * выпуск не читается — но причина иная, и она записана кодом
 * `supply_unsupported` с методом `EVM_NATIVE_V1`.
 */
async function syncEvmNativeCard(args: {
  prisma: PrismaLike;
  card: CardRow;
  now: Date;
  stats: SupplySyncStats;
}): Promise<void> {
  const { prisma, card, now, stats } = args;
  const chain = resolveEvmChain(card.nativeChain ?? "")!;
  await writeSupply({
    prisma,
    cardId: card.id,
    data: {
      chain: chain.key,
      // Идентичность сети EVM — chainId: блок 0 отдают не все узлы.
      address: String(chain.chainId),
      decimals: chain.decimals,
      method: "EVM_NATIVE_V1",
      checkedAt: now,
      checkError: "supply_unsupported",
    },
    createDefaults: true,
  });
  stats.unsupported++;
}

async function writeSupply(args: {
  prisma: PrismaLike;
  cardId: string;
  data: Record<string, unknown>;
  createDefaults?: boolean;
}): Promise<void> {
  const { prisma, cardId, data } = args;
  const create = args.createDefaults
    ? {
        address: "",
        decimals: 0,
        totalSupply: "0",
        excludedTotal: "0",
        circulating: "0",
        excluded: [],
        partial: true,
        ...data,
      }
    : data;
  await prisma.coinCardSupply.upsert({
    where: { cardId },
    update: data,
    create: { cardId, ...create },
  });
}
