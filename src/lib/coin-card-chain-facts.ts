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
  readBlockNumbers,
  readChainProperties,
  readGenesisHash,
} from "./substrate-rpc";

/** Сколько блоков берём на замер: 100 блоков по 6 с — десять минут истории. */
export const BLOCK_SAMPLE = 100;

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
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, ...EMPTY, error: errorCode(err) };
  }
}

export type MismatchCode = "SYMBOL" | "DECIMALS" | "CHAIN_SYMBOL" | "SS58_FORMAT";

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
  return out;
}

type CardRow = {
  id: string;
  nativeChain: string | null;
  symbol: string;
  tokenomics: unknown;
  provenance: unknown;
  chainFacts: { genesisHash: string } | null;
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
      provenance: true,
      chainFacts: { select: { genesisHash: true } },
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
    const mismatches = chainMismatches({
      chainKey: card.nativeChain,
      cardSymbol: card.symbol,
      claimedDecimals,
      facts: {
        symbol: facts.tokenSymbol,
        decimals: facts.tokenDecimals,
        ss58Format: facts.ss58Format,
      },
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
    await prisma.coinCard.update({
      where: { id: card.id },
      data: {
        provenance: mergeProvenance(card.provenance, {
          "payments.blockSeconds": entry,
          "payments.finalitySeconds": entry,
          "chain.symbol": entry,
          "chain.decimals": entry,
        }) as never,
      },
    });
    stats.ok++;
  }

  return stats;
}
