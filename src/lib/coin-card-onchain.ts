/**
 * Слайс B: сверка заявленного контракта с тем, что отвечает сеть.
 *
 * Главное правило: заявление проекта мы не правим. Факт сети пишется в
 * отдельные поля, расхождение — в массив `mismatches`, и читатель видит обе
 * версии. `verifiedAt` ставится только когда контракт ответил и ни одно
 * заявленное поле не разошлось — иначе «проверено» означало бы «мы смотрели»,
 * а не «сошлось».
 */

import {
  EIP1967_IMPL_SLOT,
  SELECTORS,
  decodeString,
  decodeUint,
  decodeUint8,
  hasSelector,
  implementationFromSlot,
  isDelegatedEoa,
  isEmptyBytecode,
  isEvmAddress,
  normalizeAddress,
} from "./evm-abi";
import { resolveEvmChain, rpcUrlFor } from "./evm-chains";
import { ethCall, ethGetCode, ethGetStorageAt, RpcError, type FetchLike } from "./evm-rpc";
import { mergeProvenance, type ProvenanceMap } from "./coin-card-provenance";

export type OnchainFlag =
  | "MINTABLE"
  | "PAUSABLE"
  | "BLACKLIST"
  | "UPGRADEABLE_PROXY"
  | "OWNED";

export type Mismatch = "NAME" | "SYMBOL" | "DECIMALS" | "TOTAL_SUPPLY";

export type CheckErrorCode =
  | "chain_unsupported"
  | "address_invalid"
  | "not_a_contract"
  | "not_erc20"
  | "rpc_unreachable"
  | "rpc_error"
  | "decode_failed";

export type ContractFacts = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  flags: OnchainFlag[];
  error: CheckErrorCode | null;
};

export type ContractClaim = {
  chain: string;
  address: string;
  /** Заявленные значения: у контракта — decimals, у карточки — name и symbol. */
  decimals?: number | null;
  name?: string | null;
  symbol?: string | null;
  /** Заявленный общий выпуск в монетах (tokenomics.total), не в минимальных единицах. */
  totalSupply?: number | null;
};

const EMPTY_FACTS: ContractFacts = {
  name: null,
  symbol: null,
  decimals: null,
  totalSupply: null,
  flags: [],
  error: null,
};

/* ─── чистые функции ─────────────────────────────────────────────────────── */

/**
 * Флаги по байткоду. Это наблюдение «в коде есть такая функция», а не вывод
 * «монета плохая»: у половины честных стейблкоинов есть и пауза, и чёрный
 * список. Налог на перевод по байткоду не определяется — обещать его отсутствие
 * мы не вправе, поэтому и не детектируем.
 */
export function flagsFromBytecode(bytecode: string): OnchainFlag[] {
  const flags: OnchainFlag[] = [];
  if (isEmptyBytecode(bytecode)) return flags;
  if (hasSelector(bytecode, SELECTORS.mint)) flags.push("MINTABLE");
  if (hasSelector(bytecode, SELECTORS.pause) || hasSelector(bytecode, SELECTORS.paused)) {
    flags.push("PAUSABLE");
  }
  if (
    hasSelector(bytecode, SELECTORS.blacklist) ||
    hasSelector(bytecode, SELECTORS.isBlacklisted)
  ) {
    flags.push("BLACKLIST");
  }
  if (hasSelector(bytecode, SELECTORS.upgradeTo)) flags.push("UPGRADEABLE_PROXY");
  if (hasSelector(bytecode, SELECTORS.owner)) flags.push("OWNED");
  return flags;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Выпуск в минимальных единицах → в монетах. null, когда данных не хватает. */
export function totalSupplyInCoins(raw: string | null, decimals: number | null): number | null {
  if (!raw || !/^\d+$/.test(raw) || decimals == null || decimals < 0 || decimals > 255) {
    return null;
  }
  const n = Number(raw) / 10 ** decimals;
  return Number.isFinite(n) ? n : null;
}

/**
 * Расхождения заявления и факта. Регистр и пробелы расхождением не считаются:
 * «USD Coin» и «usd coin» — одно и то же, а вот USDC против USDT — нет.
 * Для выпуска допуск 1%: проект округляет, а сеть — нет.
 */
export function compareClaims(claim: ContractClaim, facts: ContractFacts): Mismatch[] {
  const out: Mismatch[] = [];
  if (facts.error) return out;

  if (facts.symbol && claim.symbol && !sameText(facts.symbol, claim.symbol)) out.push("SYMBOL");
  if (facts.name && claim.name && !sameText(facts.name, claim.name)) out.push("NAME");
  if (facts.decimals != null && claim.decimals != null && facts.decimals !== claim.decimals) {
    out.push("DECIMALS");
  }

  const onchainTotal = totalSupplyInCoins(facts.totalSupply, facts.decimals);
  if (onchainTotal != null && claim.totalSupply != null && claim.totalSupply > 0) {
    const diff = Math.abs(onchainTotal - claim.totalSupply) / claim.totalSupply;
    if (diff > 0.01) out.push("TOTAL_SUPPLY");
  }
  return out;
}

/** Сверка удалась и сошлась — только тогда контракт считается проверенным. */
export function isVerified(facts: ContractFacts, mismatches: Mismatch[]): boolean {
  return facts.error == null && mismatches.length === 0 && facts.symbol != null;
}

type Tokenomics = { circulating?: number | null; total?: number | null; max?: number | null };

/**
 * Выпуск из сети поверх токеномики. Не затирает заявление вслепую: пишется
 * только при совпавшей сверке канонического контракта, а провенанс
 * (`mergeProvenance`) гарантирует, что самозаявление это значение потом не
 * понизит обратно.
 */
export function applyOnchainTotal(
  tokenomics: unknown,
  facts: ContractFacts,
  chainLabel: string,
  at: Date,
): { tokenomics: Tokenomics; provenance: ProvenanceMap } | null {
  const total = totalSupplyInCoins(facts.totalSupply, facts.decimals);
  if (total == null) return null;
  const base = (tokenomics ?? {}) as Tokenomics;
  return {
    tokenomics: { ...base, total },
    provenance: {
      "tokenomics.total": {
        kind: "VERIFIED_ONCHAIN",
        source: chainLabel,
        at: at.toISOString(),
      },
    },
  };
}

/* ─── чтение сети ────────────────────────────────────────────────────────── */

function errorCode(err: unknown): CheckErrorCode {
  if (err instanceof RpcError) return err.code;
  return "rpc_unreachable";
}

/**
 * Один контракт: байткод, четыре геттера, слот прокси. Последовательно и без
 * параллельных запросов — публичные узлы не для обстрела, а контрактов у нас
 * десятки, не миллионы.
 */
export async function readContractFacts(
  claim: Pick<ContractClaim, "chain" | "address">,
  opts: { fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {},
): Promise<ContractFacts> {
  const chain = resolveEvmChain(claim.chain);
  if (!chain) return { ...EMPTY_FACTS, error: "chain_unsupported" };
  if (!isEvmAddress(claim.address)) return { ...EMPTY_FACTS, error: "address_invalid" };

  const url = rpcUrlFor(chain, opts.env ?? process.env);
  const address = normalizeAddress(claim.address);
  const rpc = { fetchImpl: opts.fetchImpl };

  let bytecode: string;
  try {
    bytecode = await ethGetCode(url, address, rpc);
  } catch (err) {
    return { ...EMPTY_FACTS, error: errorCode(err) };
  }
  // Пустой код — самый важный результат сверки: по адресу кошелёк, не токен.
  // Делегация EIP-7702 даёт непустой код у обычного кошелька — это тот же случай.
  if (isEmptyBytecode(bytecode) || isDelegatedEoa(bytecode)) {
    return { ...EMPTY_FACTS, error: "not_a_contract" };
  }

  const flags = flagsFromBytecode(bytecode);

  // Геттер может отсутствовать у нестандартного токена — это не сбой сверки,
  // поэтому каждое поле читается независимо и промах оставляет null.
  const read = async <T>(selector: string, decode: (hex: string) => T): Promise<T | null> => {
    try {
      return decode(await ethCall(url, address, selector, rpc));
    } catch {
      return null;
    }
  };

  const name = await read(SELECTORS.name, decodeString);
  const symbol = await read(SELECTORS.symbol, decodeString);
  const decimals = await read(SELECTORS.decimals, decodeUint8);
  const totalSupply = await read(SELECTORS.totalSupply, decodeUint);

  if (!flags.includes("UPGRADEABLE_PROXY")) {
    try {
      const slot = await ethGetStorageAt(url, address, EIP1967_IMPL_SLOT, rpc);
      if (implementationFromSlot(slot)) flags.push("UPGRADEABLE_PROXY");
    } catch {
      // слот прочитать не удалось — флага просто нет, сверка этим не ломается
    }
  }

  const resolved = {
    name: name && name.length > 0 ? name : null,
    symbol: symbol && symbol.length > 0 ? symbol : null,
    decimals,
    totalSupply,
    flags,
  };

  // Контракт есть, но на геттеры ERC-20 не отвечает ни одним — сверять нечего,
  // и «проверено» тут было бы подписью под пустотой.
  if (resolved.symbol == null && resolved.decimals == null && resolved.totalSupply == null) {
    return { ...resolved, error: "not_erc20" };
  }
  return { ...resolved, error: null };
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

type ContractRow = {
  id: string;
  cardId: string;
  chain: string;
  address: string;
  decimals: number | null;
  isCanonical: boolean;
  card: {
    id: string;
    name: string;
    symbol: string;
    tokenomics: unknown;
    provenance: unknown;
  };
};

export type PrismaLike = {
  coinCardContract: {
    findMany(args: unknown): Promise<ContractRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCard: {
    update(args: unknown): Promise<unknown>;
  };
};

export type VerifyStats = {
  checked: number;
  verified: number;
  mismatched: number;
  failed: number;
};

export async function verifyCardContracts(args: {
  prisma: PrismaLike;
  fetchImpl?: FetchLike;
  /** Одна карточка (ручная сверка) или вся очередь (воркер). */
  cardId?: string;
  limit?: number;
  now?: Date;
}): Promise<VerifyStats> {
  const { prisma, fetchImpl, cardId } = args;
  const now = args.now ?? new Date();
  const limit = args.limit ?? 50;

  const rows = await prisma.coinCardContract.findMany({
    where: cardId ? { cardId } : {},
    orderBy: [{ checkedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      cardId: true,
      chain: true,
      address: true,
      decimals: true,
      isCanonical: true,
      card: {
        select: { id: true, name: true, symbol: true, tokenomics: true, provenance: true },
      },
    },
  });

  const stats: VerifyStats = { checked: 0, verified: 0, mismatched: 0, failed: 0 };

  for (const row of rows) {
    const tokenomics = (row.card.tokenomics ?? {}) as Tokenomics;
    const claim: ContractClaim = {
      chain: row.chain,
      address: row.address,
      decimals: row.decimals,
      name: row.card.name,
      symbol: row.card.symbol,
      totalSupply: tokenomics.total ?? null,
    };

    const facts = await readContractFacts(claim, { fetchImpl });
    const mismatches = compareClaims(claim, facts);
    const verified = isVerified(facts, mismatches);

    stats.checked++;
    if (facts.error) stats.failed++;
    else if (mismatches.length > 0) stats.mismatched++;
    else if (verified) stats.verified++;

    await prisma.coinCardContract.update({
      where: { id: row.id },
      data: {
        onchainName: facts.name,
        onchainSymbol: facts.symbol,
        onchainDecimals: facts.decimals,
        onchainTotalSupply: facts.totalSupply,
        onchainFlags: facts.flags,
        mismatches,
        checkedAt: now,
        checkError: facts.error,
        // Расхождение снимает прежнее «проверено»: иначе карточка показывала бы
        // зелёную метку рядом с красным расхождением.
        verifiedAt: verified ? now : null,
      },
    });

    if (verified && row.isCanonical) {
      const applied = applyOnchainTotal(tokenomics, facts, row.chain, now);
      if (applied) {
        await prisma.coinCard.update({
          where: { id: row.cardId },
          data: {
            tokenomics: applied.tokenomics as never,
            provenance: mergeProvenance(row.card.provenance, applied.provenance) as never,
          },
        });
      }
    }
  }

  return stats;
}
