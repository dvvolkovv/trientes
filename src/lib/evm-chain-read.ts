/**
 * Чтение сети EVM для нативной монеты (слайс Z): головы, время блока, цена
 * газа.
 *
 * Отдельно от `evm-rpc.ts`: тот отвечает за `eth_call` и контракты токенов
 * (слайс B), здесь же ни одного обращения к контракту нет — читается сама цепь.
 * Транспорт и классификация сбоя общие, из `json-rpc.ts`.
 *
 * Формы ответов проверены живыми запросами по семнадцати адресам 9 ноября 2026.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";

/** Заголовок блока: только то, что нужно карточке. */
export type EvmBlock = {
  number: number;
  hash: string;
  timeMs: number;
};

/** Тег блока: номер, лучшая голова или финализированная. */
export type EvmBlockTag = number | "latest" | "finalized";

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") throw new RpcError("decode_failed");
  return v as Record<string, unknown>;
}

/** Hex-число из ответа узла. Пустая строка и мусор — `decode_failed`. */
export function hexToBigInt(raw: unknown): bigint {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new RpcError("decode_failed", "not_hex");
  }
  return BigInt(raw);
}

export function hexToNumber(raw: unknown): number {
  const value = hexToBigInt(raw);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcError("decode_failed", "too_big");
  return Number(value);
}

/** `chainId` узла. Идентичность сети закреплена консенсусом и не меняется. */
export async function readEvmChainId(url: string, opts: RpcOptions = {}): Promise<number> {
  return hexToNumber(await jsonRpc(url, "eth_chainId", [], opts));
}

/**
 * Заголовок блока. `null` означает «такого блока у узла нет»: обрезанная база
 * не держит блок 0 (Cronos, Hyperliquid), а цепь без тега `finalized` отвечает
 * на него пустотой. Это свойство узла, а не сбой чтения, поэтому `null`, а не
 * исключение.
 */
export async function readEvmBlock(
  url: string,
  tag: EvmBlockTag,
  opts: RpcOptions = {},
): Promise<EvmBlock | null> {
  const param = typeof tag === "number" ? `0x${tag.toString(16)}` : tag;
  let raw: unknown;
  try {
    raw = await jsonRpc(url, "eth_getBlockByNumber", [param, false], opts);
  } catch (err) {
    // «unknown block» — ответ узла о своей базе, а не обрыв связи.
    if (err instanceof RpcError && err.code === "rpc_error") return null;
    throw err;
  }
  if (raw == null) return null;
  const block = asRecord(raw);
  const hash = block.hash;
  if (typeof hash !== "string") throw new RpcError("decode_failed", "no_hash");
  return {
    number: hexToNumber(block.number),
    // Узел Sei отдаёт хэш заглавными буквами: приводим к нижнему регистру,
    // иначе сравнение с реестром ложно считало бы цепь подменённой.
    hash: hash.toLowerCase(),
    timeMs: hexToNumber(block.timestamp) * 1000,
  };
}

/** Лучшая голова: без неё читать нечего, поэтому её отсутствие — сбой. */
export async function readEvmHead(url: string, opts: RpcOptions = {}): Promise<EvmBlock> {
  const head = await readEvmBlock(url, "latest", opts);
  if (!head) throw new RpcError("decode_failed", "no_head");
  return head;
}

/**
 * Отставание финализации в блоках.
 *
 * Отрицательное отставание — артефакт чтения, а не факт: головы читаются двумя
 * запросами, и на цепи с блоком в полсекунды финализированная успевает уйти
 * вперёд лучшей (живой прогон поймал −1 у Sei и Hyperliquid). Приводим к нулю.
 */
export function finalityLagOf(best: number, finalized: number): number {
  return Math.max(0, best - finalized);
}

/**
 * Время блока — замер по двум заголовкам, как во всех прежних семьях.
 */
export async function measureEvmBlockSeconds(
  url: string,
  best: EvmBlock,
  span: number,
  opts: RpcOptions = {},
): Promise<{ blockSeconds: number; sample: number }> {
  const sample = Math.max(1, Math.min(span, best.number - 1));
  const past = await readEvmBlock(url, best.number - sample, opts);
  if (!past) throw new RpcError("decode_failed", "no_past_block");
  const seconds = (best.timeMs - past.timeMs) / 1000 / sample;
  if (!(seconds > 0)) throw new RpcError("decode_failed", "non_positive_block_time");
  return { blockSeconds: Math.round(seconds * 100) / 100, sample };
}

/**
 * Цена газа по оценке самого узла. У сетей с EIP-1559 это базовая плата плюс
 * предложенная надбавка — то есть число самого узла, а не наш расчёт поверх
 * `eth_feeHistory`.
 *
 * `null` — узел метод не поддерживает; остальные факты от этого не теряются.
 */
export async function readEvmGasPrice(url: string, opts: RpcOptions = {}): Promise<bigint | null> {
  try {
    const price = hexToBigInt(await jsonRpc(url, "eth_gasPrice", [], opts));
    return price > BigInt(0) ? price : null;
  } catch (err) {
    if (err instanceof RpcError && err.code === "rpc_error") return null;
    throw err;
  }
}

/**
 * Комиссия эталонного перевода в wei: цена газа × газ перевода. Газ здесь —
 * константа протокола (21 000 за перевод без данных), а не выбранный нами
 * размер, как в семье Bitcoin.
 */
export function transferFeeWei(gasPrice: bigint, gas: number): bigint {
  return gasPrice * BigInt(gas);
}
