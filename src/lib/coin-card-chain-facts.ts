/**
 * Факты собственной сети нативной монеты (слайс S): тикер, знаки, хэш
 * генезиса, измеренное время блока, отставание финализации.
 *
 * Время блока и финальность — замер, а не константа рантайма: продавцу важна
 * фактическая скорость, и поэтому рядом с числом хранятся номера блоков и
 * время замера. Заявление проекта в `payments` не перезаписывается — рендер
 * предпочитает факт, а расхождение показывает рядом (правило слайса B).
 */

import {
  bitcoinApiUrlFor,
  resolveBitcoinChain,
  type BitcoinChain,
} from "./bitcoin-chains";
import {
  measureBitcoinBlockSeconds,
  readBitcoinBlockHash,
  readBitcoinFeeRate,
  readBitcoinTip,
  transferFeeSats,
  type TextFetch,
} from "./bitcoin-rest";
import { mergeProvenance } from "./coin-card-provenance";
import { resolveCosmosChain, cosmosRestUrlFor } from "./cosmos-chains";
import {
  measureCosmosBlockSeconds,
  readCosmosBlock,
  readCosmosDenomMeta,
  readCosmosMinGasPrice,
  type HttpFetch,
} from "./cosmos-rest";
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
 * Предел отставания финализации, за которым число перестаёт быть свойством
 * сети. Живой прогон 9 ноября поймал у публичного узла Astar лучшую голову на
 * 9810 блоков впереди финализированной — умножение дало «финализация 17
 * часов». Это застрявшая финализация у цепи или у самого узла в тот миг, и
 * показывать её как измеренную скорость сети нельзя. Порог в 600 блоков — это
 * час на шестисекундной цепи: всё, что дольше, разбирается руками по
 * `finalityLag`, который остаётся записанным.
 */
export const FINALITY_LAG_MAX = 600;

/** Секунды финализации, если отставание правдоподобно; иначе их нет. */
export function finalitySecondsFor(lag: number, blockSeconds: number): number | null {
  if (lag > FINALITY_LAG_MAX) return null;
  return Math.round(lag * blockSeconds * 100) / 100;
}

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

/** Какой ридер отвечал: от этого зависят и подписи в карточке, и охранник переезда. */
export type ChainFamily = "SUBSTRATE" | "COSMOS" | "BITCOIN";

export type ChainFacts = {
  chain: string;
  family: ChainFamily;
  genesisHash: string | null;
  /** Идентичность сети Cosmos. У Substrate остаётся null. */
  chainId: string | null;
  /** Минимальная цена газа по узлу. У Substrate остаётся null. */
  minGasPrice: string | null;
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
  chainId: null,
  minGasPrice: null,
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

/**
 * Факты сети по ключу из одного из двух реестров. Развилка по семье здесь, а не
 * у вызывающего: карточка знает только ключ сети, а какой это протокол —
 * свойство реестра, в котором ключ нашёлся.
 */
export async function readChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const substrate = resolveSubstrateChain(args.chain);
  if (substrate) return readSubstrateChainFacts({ ...args, chain: substrate.key });
  if (resolveCosmosChain(args.chain)) return readCosmosChainFacts(args);
  if (resolveBitcoinChain(args.chain)) return readBitcoinChainFacts(args);
  return { chain: args.chain, family: "SUBSTRATE", ...EMPTY, error: "chain_unsupported" };
}

async function readSubstrateChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const chain = resolveSubstrateChain(args.chain);
  if (!chain) return { chain: args.chain, family: "SUBSTRATE", ...EMPTY, error: "chain_unsupported" };

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
      family: "SUBSTRATE",
      chainId: null,
      minGasPrice: null,
      genesisHash,
      tokenSymbol: props.symbol,
      tokenDecimals: props.decimals,
      ss58Format: props.ss58Format,
      blockSeconds: time.blockSeconds,
      blockSample: time.sample,
      bestNumber: numbers.best,
      finalizedNumber: numbers.finalized,
      finalityLag: numbers.lag,
      finalitySeconds: finalitySecondsFor(numbers.lag, time.blockSeconds),
      transferFeePlanck: fee.planck,
      transferFeeTokens: fee.tokens,
      transferFeeError: fee.error,
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, family: "SUBSTRATE", ...EMPTY, error: errorCode(err) };
  }
}

/**
 * Факты сети на Cosmos SDK. Отличий от Substrate три, и все честные:
 * идентичность сети — chain-id, а не хэш генезиса; блок считается
 * окончательным в момент включения, поэтому отставание финализации нулевое; а
 * комиссию перевода этой семье пока никто не считает — вместо неё узел
 * сообщает минимальную цену газа.
 *
 * Тикер и знаки берутся из реестра денома, если узел его знает. Injective,
 * Kava и Secret не знают — тогда полей просто нет, и подставлять ожидаемое из
 * нашего реестра нельзя: «прочитано из сети» означало бы «взято у нас».
 */
async function readCosmosChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const chain = resolveCosmosChain(args.chain);
  if (!chain) return { chain: args.chain, family: "COSMOS", ...EMPTY, error: "chain_unsupported" };

  const url = cosmosRestUrlFor(chain);
  // Оба ридера принимают инъектируемый fetch, но типы у них разные: у Substrate
  // это POST с телом, у Cosmos — GET. Поддельный fetch в тестах один и тот же.
  const opts = { fetchImpl: args.fetchImpl as unknown as HttpFetch, timeoutMs: args.timeoutMs };
  const sample = args.sample ?? BLOCK_SAMPLE;

  try {
    const best = await readCosmosBlock(url, "latest", opts);
    const time = await measureCosmosBlockSeconds(url, best, sample, opts);
    const meta = await readCosmosDenomMeta(url, chain.denom, opts);
    const minGasPrice = await readCosmosMinGasPrice(url, chain.denom, opts);
    return {
      chain: chain.key,
      family: "COSMOS",
      genesisHash: null,
      chainId: best.chainId,
      minGasPrice,
      tokenSymbol: meta.symbol,
      tokenDecimals: meta.exponent,
      ss58Format: null,
      blockSeconds: time.blockSeconds,
      blockSample: time.sample,
      bestNumber: best.height,
      finalizedNumber: best.height,
      finalityLag: 0,
      finalitySeconds: 0,
      transferFeePlanck: null,
      transferFeeTokens: null,
      transferFeeError: "fee_unsupported",
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, family: "COSMOS", ...EMPTY, error: errorCode(err) };
  }
}

/**
 * Факты цепи семьи Bitcoin (слайс Y). Отличий от двух прежних семей три, и все
 * они свойства протокола, а не нашей лени:
 *
 * 1. **Идентичность — хэш блока 0 и контрольный блок.** Генезис у форков общий
 *    (Bitcoin Cash, Bitcoin SV, Bitcoin Gold родились из блока 0 Bitcoin),
 *    поэтому у цепи с форками реестр задаёт ещё и блок выше точки форка.
 *    Расхождение любого из двух — `genesis_mismatch`, и числа не пишутся: узел
 *    отвечает не за ту цепь, которую мы в него записали.
 * 2. **Финализации нет.** В PoW блок не становится окончательным, вероятность
 *    переписывания лишь падает с подтверждениями. Числа финализации остаются
 *    `null`, а в карточке стоит «вероятностная» — соглашение о шести
 *    подтверждениях принадлежит получателю, а не сети, и выдавать его за
 *    измеренный факт нельзя.
 * 3. **Тикера и знаков в этих API нет.** Оставляем непрочитанными — тот же
 *    случай, что Injective, Kava и Secret в семье Cosmos.
 */
async function readBitcoinChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const chain = resolveBitcoinChain(args.chain);
  if (!chain) return { chain: args.chain, family: "BITCOIN", ...EMPTY, error: "chain_unsupported" };

  const url = bitcoinApiUrlFor(chain);
  // Ридеры трёх семей принимают инъектируемый fetch, но ответы читают
  // по-разному: Substrate — json() после POST, Cosmos — json() после GET,
  // Bitcoin — text(), потому что высота головы приходит голым числом.
  const opts = { fetchImpl: args.fetchImpl as unknown as TextFetch, timeoutMs: args.timeoutMs };
  const sample = args.sample ?? BLOCK_SAMPLE;

  try {
    const genesisHash = await readBitcoinBlockHash(chain, url, 0, opts);
    if (genesisHash !== chain.genesisHash) {
      return { chain: chain.key, family: "BITCOIN", ...EMPTY, error: "genesis_mismatch" };
    }
    if (chain.checkpoint) {
      const hash = await readBitcoinBlockHash(chain, url, chain.checkpoint.height, opts);
      if (hash !== chain.checkpoint.hash) {
        return { chain: chain.key, family: "BITCOIN", ...EMPTY, error: "genesis_mismatch" };
      }
    }
    const tip = await readBitcoinTip(chain, url, opts);
    const time = await measureBitcoinBlockSeconds(chain, url, tip, sample, opts);
    const fee = await readBitcoinTransferFee(chain, url, opts);
    return {
      chain: chain.key,
      family: "BITCOIN",
      genesisHash,
      chainId: null,
      minGasPrice: null,
      tokenSymbol: null,
      tokenDecimals: null,
      ss58Format: null,
      blockSeconds: time.blockSeconds,
      blockSample: time.sample,
      bestNumber: tip.height,
      finalizedNumber: null,
      finalityLag: null,
      finalitySeconds: null,
      transferFeePlanck: fee.planck,
      transferFeeTokens: fee.tokens,
      transferFeeError: fee.error,
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, family: "BITCOIN", ...EMPTY, error: errorCode(err) };
  }
}

/**
 * Комиссия эталонного перевода в семье Bitcoin: цену за байт оценивает сам
 * узел, размер перевода (один вход, два выхода) задан реестром. Это модель, и
 * подпись в карточке называет оба слагаемых.
 *
 * Знаки берутся из реестра, а не из сети: прочитать их здесь неоткуда, а во
 * всей семье единица — сатоши, 10⁻⁸ монеты. Поэтому `tokenDecimals` в фактах
 * остаётся пустым, но перевод сатоши в монеты возможен.
 */
async function readBitcoinTransferFee(
  chain: BitcoinChain,
  url: string,
  opts: { fetchImpl?: TextFetch; timeoutMs?: number },
): Promise<FeeRead> {
  try {
    const rate = await readBitcoinFeeRate(chain, url, opts);
    if (rate == null) return { ...FEE_UNREAD, error: "fee_unsupported" };
    const sats = transferFeeSats(rate, chain.txVsize);
    return {
      planck: sats.toString(),
      tokens: Number(sats) / 10 ** chain.decimals,
      error: null,
    };
  } catch (err) {
    return {
      ...FEE_UNREAD,
      error: err instanceof RpcError ? (err.code as TransferFeeError) : "rpc_error",
    };
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

export type MismatchCode =
  | "SYMBOL"
  | "DECIMALS"
  | "CHAIN_SYMBOL"
  | "SS58_FORMAT"
  | "CHAIN_ID"
  | "FEE_USD";

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
  facts: {
    symbol: string | null;
    decimals: number | null;
    ss58Format: number | null;
    chainId?: string | null;
  };
  fee?: { declaredUsd: number | null; factTokens: number | null; priceUsd: number | null };
}): MismatchCode[] {
  const out: MismatchCode[] = [];
  const substrate = resolveSubstrateChain(args.chainKey);
  const cosmos = substrate ? null : resolveCosmosChain(args.chainKey);
  const expectedSymbol = substrate?.symbol ?? cosmos?.symbol ?? null;
  const { symbol, decimals, ss58Format, chainId } = args.facts;

  if (symbol && args.cardSymbol && symbol.toUpperCase() !== args.cardSymbol.toUpperCase()) {
    out.push("SYMBOL");
  }
  if (decimals != null && args.claimedDecimals != null && decimals !== args.claimedDecimals) {
    out.push("DECIMALS");
  }
  if (expectedSymbol && symbol && symbol.toUpperCase() !== expectedSymbol.toUpperCase()) {
    out.push("CHAIN_SYMBOL");
  }
  if (substrate && substrate.ss58Format != null && ss58Format != null && ss58Format !== substrate.ss58Format) {
    out.push("SS58_FORMAT");
  }
  // Узел представился другой цепью, чем записано в реестре: это либо подмена
  // адреса в окружении, либо переезд сети на новый chain-id.
  if (cosmos && chainId && chainId !== cosmos.chainId) out.push("CHAIN_ID");
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
  chainFacts: { genesisHash: string | null; chainId: string | null } | null;
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
      chainFacts: { select: { genesisHash: true, chainId: true } },
      priceIndex: { select: { priceUsd: true } },
    },
  });

  const stats: ChainFactsStats = { cards: 0, ok: 0, failed: 0 };

  for (const card of cards) {
    if (!card.nativeChain) continue;
    stats.cards++;
    const facts = await readChainFacts({ chain: card.nativeChain, fetchImpl });

    // Идентичность сети изменилась — узел переехал на другую цепь. Числа не
    // перезаписываем: это повод для разбора руками, а не новость о монете.
    // У Substrate идентичность — хэш генезиса, у Cosmos — chain-id.
    const identity = facts.family === "COSMOS" ? facts.chainId : facts.genesisHash;
    const stored =
      facts.family === "COSMOS" ? card.chainFacts?.chainId : card.chainFacts?.genesisHash;
    // Записанная идентичность пуста, когда первое чтение сорвалось: такую
    // строку новая, успешно прочитанная, вправе заполнить. Со сравнением
    // «пусто !== прочитано» карточка застревала в genesis_mismatch навсегда —
    // живой случай Neutron, узел которого не реализует base/node/config.
    const moved = Boolean(!facts.error && identity && stored && stored !== identity);

    if (facts.error || moved) {
      stats.failed++;
      const checkError = moved ? "genesis_mismatch" : facts.error;
      await prisma.coinCardChainFacts.upsert({
        where: { cardId: card.id },
        update: { checkedAt: now, checkError },
        create: {
          cardId: card.id,
          chain: card.nativeChain,
          family: facts.family,
          genesisHash: facts.genesisHash,
          chainId: facts.chainId,
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
        chainId: facts.chainId,
      },
      fee: { declaredUsd: declaredFeeUsd, factTokens: facts.transferFeeTokens, priceUsd },
    });

    const data = {
      chain: facts.chain,
      family: facts.family,
      genesisHash: facts.genesisHash,
      chainId: facts.chainId,
      minGasPrice: facts.minGasPrice,
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
          // Застрявшую финализацию мы не записали числом — помечать её
          // проверенной тоже нечем.
          ...(facts.finalitySeconds != null ? { "payments.finalitySeconds": entry } : {}),
          // Реестр денома есть не у всякой сети Cosmos: чего не прочитали, то и
          // не помечаем проверенным.
          ...(facts.tokenSymbol != null ? { "chain.symbol": entry } : {}),
          ...(facts.tokenDecimals != null ? { "chain.decimals": entry } : {}),
          ...(feeVerified ? { "payments.feeUsdTypical": entry } : {}),
        }) as never,
      },
    });
    stats.ok++;
  }

  return stats;
}
