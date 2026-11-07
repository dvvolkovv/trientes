/**
 * Факты собственной сети нативной монеты (слайс S): тикер, знаки, хэш
 * генезиса, измеренное время блока, отставание финализации.
 *
 * Время блока и финальность — замер, а не константа рантайма: продавцу важна
 * фактическая скорость, и поэтому рядом с числом хранятся номера блоков и
 * время замера. Заявление проекта в `payments` не перезаписывается — рендер
 * предпочитает факт, а расхождение показывает рядом (правило слайса B).
 */

import { mergeProvenance } from "./coin-card-provenance";
import { RpcError, type FetchLike } from "./json-rpc";
import { resolveSubstrateChain, substrateRpcUrlFor } from "./substrate-chains";
import {
  measureBlockSeconds,
  queryTransferFee,
  readBlockNumbers,
  readChainProperties,
  readGenesisHash,
  readRuntimeVersion,
} from "./substrate-rpc";

/** Сколько блоков берём на замер: 100 блоков по 6 с — десять минут истории. */
export const BLOCK_SAMPLE = 100;

/**
 * Почему комиссия неизвестна. Отдельно от `checkError`: сбой расчёта комиссии
 * не отменяет остальных фактов сети, а ноль у комиссии — допустимое значение,
 * поэтому «нет данных» отличается от «ноль» типом, а не магическим числом.
 */
export type TransferFeeError =
  | "fee_unsupported"
  | "runtime_changed"
  | "rpc_unreachable"
  | "rpc_error"
  | "decode_failed";

export type ChainFactsError =
  | "chain_unsupported"
  | "rpc_unreachable"
  | "rpc_error"
  | "decode_failed"
  | "genesis_mismatch";

export type ChainFacts = {
  chain: string;
  genesisHash: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  ss58Format: number | null;
  blockSeconds: number | null;
  blockSample: number | null;
  bestNumber: number | null;
  finalizedNumber: number | null;
  finalityLag: number | null;
  finalitySeconds: number | null;
  /** Комиссия эталонного перевода в наименьших единицах, строкой из RPC. */
  transferFeePlanck: string | null;
  transferFeeTokens: number | null;
  transferFeeError: TransferFeeError | null;
  error: ChainFactsError | null;
};

const EMPTY = {
  genesisHash: null,
  tokenSymbol: null,
  tokenDecimals: null,
  ss58Format: null,
  blockSeconds: null,
  blockSample: null,
  bestNumber: null,
  finalizedNumber: null,
  finalityLag: null,
  finalitySeconds: null,
  transferFeePlanck: null,
  transferFeeTokens: null,
  transferFeeError: null,
};

const errorCode = (err: unknown): ChainFactsError =>
  err instanceof RpcError ? (err.code as ChainFactsError) : "rpc_error";

export async function readChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const chain = resolveSubstrateChain(args.chain);
  if (!chain) return { chain: args.chain, ...EMPTY, error: "chain_unsupported" };

  const url = substrateRpcUrlFor(chain);
  const opts = { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs };
  const sample = args.sample ?? BLOCK_SAMPLE;

  try {
    const props = await readChainProperties(url, opts);
    const genesisHash = await readGenesisHash(url, opts);
    const numbers = await readBlockNumbers(url, opts);
    // Молодая цепь короче выборки: замер делаем по тому, что есть.
    const span = Math.max(1, Math.min(sample, numbers.best - 1));
    const time = await measureBlockSeconds(url, numbers.best, span, opts);
    const fee = await readTransferFee(url, chain.key, props.decimals, opts);
    return {
      chain: chain.key,
      genesisHash,
      tokenSymbol: props.symbol,
      tokenDecimals: props.decimals,
      ss58Format: props.ss58Format,
      blockSeconds: time.blockSeconds,
      blockSample: time.sample,
      bestNumber: numbers.best,
      finalizedNumber: numbers.finalized,
      finalityLag: numbers.lag,
      finalitySeconds: Math.round(numbers.lag * time.blockSeconds * 100) / 100,
      transferFeePlanck: fee.planck,
      transferFeeTokens: fee.tokens,
      transferFeeError: fee.error,
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, ...EMPTY, error: errorCode(err) };
  }
}

type FeeRead = {
  planck: string | null;
  tokens: number | null;
  error: TransferFeeError | null;
};

const FEE_UNREAD = { planck: null, tokens: null };

/**
 * Комиссия эталонного перевода. Сбой здесь не роняет прогон: остальные факты
 * сети уже прочитаны и полезны сами по себе.
 *
 * Версия формата транзакций сверяется с пришпиленной в реестре: сеть бампает её
 * при смене индексов вызовов, а значит наш собранный экстринсик мог стать
 * экстринсиком другого вызова. Устаревшее число хуже отсутствующего.
 */
async function readTransferFee(
  url: string,
  chainKey: string,
  decimals: number | null,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<FeeRead> {
  const chain = resolveSubstrateChain(chainKey);
  if (!chain || chain.balancesPallet == null || decimals == null) {
    return { ...FEE_UNREAD, error: "fee_unsupported" };
  }
  try {
    const version = await readRuntimeVersion(url, opts);
    if (version.transactionVersion !== chain.transactionVersion) {
      return { ...FEE_UNREAD, error: "runtime_changed" };
    }
    const fee = await queryTransferFee({
      url,
      pallet: chain.balancesPallet,
      decimals,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    return { planck: fee.planck.toString(), tokens: fee.tokens, error: null };
  } catch (err) {
    return {
      ...FEE_UNREAD,
      error: err instanceof RpcError ? (err.code as TransferFeeError) : "rpc_error",
    };
  }
}

export type MismatchCode = "SYMBOL" | "DECIMALS" | "CHAIN_SYMBOL" | "SS58_FORMAT" | "FEE_USD";

/** Цент: ниже этой разницы относительные проценты шумят. */
const FEE_MISMATCH_USD = 0.01;
/** Та же десятая доля, что и у остальных расхождений карточки. */
const FEE_MISMATCH_SHARE = 0.1;

/**
 * Значимо ли расхождение заявленной комиссии с проверенной. Значимым считается
 * только то, что больше и десяти процентов, и цента: у сети с комиссией в доли
 * микроцента относительная разница срабатывала бы всегда.
 */
export function feeMismatch(args: {
  declaredUsd: number | null;
  factTokens: number | null;
  priceUsd: number | null;
}): boolean {
  const { declaredUsd, factTokens, priceUsd } = args;
  if (declaredUsd == null || factTokens == null || priceUsd == null || priceUsd <= 0) return false;
  const factUsd = factTokens * priceUsd;
  const diff = Math.abs(declaredUsd - factUsd);
  return diff > FEE_MISMATCH_USD && diff > FEE_MISMATCH_SHARE * factUsd;
}

/**
 * Расхождения двух видов: сеть против карточки (`SYMBOL`, `DECIMALS`) и сеть
 * против реестра (`CHAIN_SYMBOL`, `SS58_FORMAT`). Второе означает, что узел
 * отвечает не за ту цепь, которую мы в него записали, — и это тревожнее
 * первого.
 */
export function chainMismatches(args: {
  chainKey: string;
  cardSymbol: string;
  claimedDecimals: number | null;
  facts: { symbol: string | null; decimals: number | null; ss58Format: number | null };
  fee?: { declaredUsd: number | null; factTokens: number | null; priceUsd: number | null };
}): MismatchCode[] {
  const out: MismatchCode[] = [];
  const registry = resolveSubstrateChain(args.chainKey);
  const { symbol, decimals, ss58Format } = args.facts;

  if (symbol && args.cardSymbol && symbol.toUpperCase() !== args.cardSymbol.toUpperCase()) {
    out.push("SYMBOL");
  }
  if (decimals != null && args.claimedDecimals != null && decimals !== args.claimedDecimals) {
    out.push("DECIMALS");
  }
  if (registry && symbol && symbol.toUpperCase() !== registry.symbol.toUpperCase()) {
    out.push("CHAIN_SYMBOL");
  }
  if (registry && ss58Format != null && ss58Format !== registry.ss58Format) {
    out.push("SS58_FORMAT");
  }
  if (args.fee && feeMismatch(args.fee)) out.push("FEE_USD");
  return out;
}

type CardRow = {
  id: string;
  nativeChain: string | null;
  symbol: string;
  tokenomics: unknown;
  payments: unknown;
  provenance: unknown;
  chainFacts: { genesisHash: string } | null;
  priceIndex: { priceUsd: number } | null;
};

export type ChainFactsPrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<CardRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCardChainFacts: { upsert(args: unknown): Promise<unknown> };
};

export type ChainFactsStats = { cards: number; ok: number; failed: number };

export async function syncChainFacts(args: {
  prisma: ChainFactsPrismaLike;
  fetchImpl?: FetchLike;
  cardId?: string;
  limit?: number;
  now?: Date;
}): Promise<ChainFactsStats> {
  const { prisma, fetchImpl, cardId } = args;
  const now = args.now ?? new Date();
  const cards = await prisma.coinCard.findMany({
    where: cardId ? { id: cardId } : { status: "APPROVED", nativeChain: { not: null } },
    take: args.limit ?? 50,
    orderBy: [{ updatedAt: "asc" }],
    select: {
      id: true,
      nativeChain: true,
      symbol: true,
      tokenomics: true,
      payments: true,
      provenance: true,
      chainFacts: { select: { genesisHash: true } },
      priceIndex: { select: { priceUsd: true } },
    },
  });

  const stats: ChainFactsStats = { cards: 0, ok: 0, failed: 0 };

  for (const card of cards) {
    if (!card.nativeChain) continue;
    stats.cards++;
    const facts = await readChainFacts({ chain: card.nativeChain, fetchImpl });

    // Хэш генезиса изменился — узел переехал на другую цепь. Числа не
    // перезаписываем: это повод для разбора руками, а не новость о монете.
    const moved = Boolean(
      !facts.error &&
        card.chainFacts &&
        facts.genesisHash &&
        card.chainFacts.genesisHash !== facts.genesisHash,
    );

    if (facts.error || moved) {
      stats.failed++;
      const checkError = moved ? "genesis_mismatch" : facts.error;
      await prisma.coinCardChainFacts.upsert({
        where: { cardId: card.id },
        update: { checkedAt: now, checkError },
        create: {
          cardId: card.id,
          chain: card.nativeChain,
          genesisHash: facts.genesisHash ?? "",
          checkedAt: now,
          checkError,
        },
      });
      continue;
    }

    const claimedDecimals =
      (card.tokenomics as { decimals?: number | null } | null)?.decimals ?? null;
    const declaredFeeUsd =
      (card.payments as { feeUsdTypical?: number | null } | null)?.feeUsdTypical ?? null;
    const priceUsd = card.priceIndex?.priceUsd ?? null;
    const mismatches = chainMismatches({
      chainKey: card.nativeChain,
      cardSymbol: card.symbol,
      claimedDecimals,
      facts: {
        symbol: facts.tokenSymbol,
        decimals: facts.tokenDecimals,
        ss58Format: facts.ss58Format,
      },
      fee: { declaredUsd: declaredFeeUsd, factTokens: facts.transferFeeTokens, priceUsd },
    });

    const data = {
      chain: facts.chain,
      genesisHash: facts.genesisHash ?? "",
      tokenSymbol: facts.tokenSymbol,
      tokenDecimals: facts.tokenDecimals,
      ss58Format: facts.ss58Format,
      blockSeconds: facts.blockSeconds,
      blockSample: facts.blockSample,
      bestNumber: facts.bestNumber,
      finalizedNumber: facts.finalizedNumber,
      finalityLag: facts.finalityLag,
      finalitySeconds: facts.finalitySeconds,
      transferFeePlanck: facts.transferFeePlanck,
      transferFeeTokens: facts.transferFeeTokens,
      transferFeeError: facts.transferFeeError,
      mismatches,
      checkedAt: now,
      checkError: null as string | null,
    };
    await prisma.coinCardChainFacts.upsert({
      where: { cardId: card.id },
      update: data,
      create: { cardId: card.id, ...data },
    });

    const entry = { kind: "VERIFIED_ONCHAIN" as const, source: facts.chain, at: now.toISOString() };
    // Комиссия подтверждается как USD-число только когда цена известна: без
    // индекса цены проверенного числа в долларах у нас нет.
    const feeVerified = facts.transferFeeTokens != null && priceUsd != null;
    await prisma.coinCard.update({
      where: { id: card.id },
      data: {
        provenance: mergeProvenance(card.provenance, {
          "payments.blockSeconds": entry,
          "payments.finalitySeconds": entry,
          "chain.symbol": entry,
          "chain.decimals": entry,
          ...(feeVerified ? { "payments.feeUsdTypical": entry } : {}),
        }) as never,
      },
    });
    stats.ok++;
  }

  return stats;
}
