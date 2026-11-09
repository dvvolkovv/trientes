/**
 * Типизированные чтения Substrate-узла. Каждая функция отвечает за один факт и
 * бросает `RpcError` с теми же кодами, что уже умеет слайс B: коды попадают в
 * карточку как `checkError`, и общий словарь важнее удобства.
 */

import { jsonRpc, RpcError, type FetchLike, type RpcOptions } from "./json-rpc";
import { fakeSignedExtrinsic, transferKeepAliveCall } from "./substrate-extrinsic";
import {
  decodeAccountBalance,
  decodeUintLE,
  ss58Decode,
  systemAccountKey,
  timestampNowKey,
  totalIssuanceKey,
} from "./substrate-codec";

export type ChainProperties = {
  decimals: number | null;
  symbol: string | null;
  ss58Format: number | null;
};

/** Мультиассетные сети отдают массивы: берём первую, основную единицу. */
const firstOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/**
 * Префикс SS58 сети публикуют под разными именами: `ss58Format` (Polkadot),
 * `SS58Prefix` (Moonbeam, Moonriver), `ss58format` (Vara). Строгий поиск по
 * одному написанию оставлял три сети вообще без сверки префикса, хотя узел его
 * сообщает. Нечисловое значение — не догадка, а `null`: ожидание реестра
 * должно сверяться с числом от узла или не сверяться вовсе.
 */
const PREFIX_KEYS = ["ss58format", "ss58prefix"];

function prefixOf(p: Record<string, unknown>): number | null {
  for (const [k, v] of Object.entries(p)) {
    if (PREFIX_KEYS.includes(k.toLowerCase()) && typeof v === "number") return v;
  }
  return null;
}

export async function readChainProperties(
  url: string,
  opts: RpcOptions = {},
): Promise<ChainProperties> {
  const raw = await jsonRpc(url, "system_properties", [], opts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RpcError("decode_failed");
  const p = raw as Record<string, unknown>;
  const decimals = firstOf(p.tokenDecimals);
  const symbol = firstOf(p.tokenSymbol);
  return {
    decimals: typeof decimals === "number" ? decimals : null,
    symbol: typeof symbol === "string" ? symbol : null,
    ss58Format: prefixOf(p),
  };
}

/**
 * Общий выпуск в минимальных единицах. Пустое хранилище — сбой, а не ноль: у
 * работающей цепи выпуск есть всегда, а ноль молча превратился бы в «нулевой
 * оборот» и обнулил капитализацию.
 */
export async function readTotalIssuance(url: string, opts: RpcOptions = {}): Promise<bigint> {
  const raw = await jsonRpc(url, "state_getStorage", [totalIssuanceKey()], opts);
  const v = typeof raw === "string" ? decodeUintLE(raw) : null;
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

/**
 * Баланс счёта по SS58-адресу. Префикс проверяется до запроса: адрес Polkadot,
 * вписанный в карточку монеты Taler, имеет тот же публичный ключ и вернул бы
 * честный ноль — то есть молча занизил бы исключённый выпуск.
 */
export async function readAccountBalance(
  url: string,
  address: string,
  expectedPrefix: number | null,
  opts: RpcOptions = {},
): Promise<bigint> {
  const parts = ss58Decode(address);
  if (!parts || (expectedPrefix != null && parts.prefix !== expectedPrefix)) {
    throw new RpcError("rpc_error", "address_invalid");
  }
  const raw = await jsonRpc(url, "state_getStorage", [systemAccountKey(parts.pubkey)], opts);
  const v = decodeAccountBalance(typeof raw === "string" ? raw : null);
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

export async function readGenesisHash(url: string, opts: RpcOptions = {}): Promise<string> {
  const raw = await jsonRpc(url, "chain_getBlockHash", [0], opts);
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw)) {
    throw new RpcError("decode_failed");
  }
  return raw;
}

function headerNumber(raw: unknown): number {
  if (!raw || typeof raw !== "object") throw new RpcError("decode_failed");
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "string") throw new RpcError("decode_failed");
  const parsed = Number.parseInt(n, 16);
  if (!Number.isFinite(parsed)) throw new RpcError("decode_failed");
  return parsed;
}

export type BlockNumbers = { best: number; finalized: number; lag: number };

export async function readBlockNumbers(url: string, opts: RpcOptions = {}): Promise<BlockNumbers> {
  const best = headerNumber(await jsonRpc(url, "chain_getHeader", [], opts));
  const finalizedHash = await jsonRpc(url, "chain_getFinalizedHead", [], opts);
  if (typeof finalizedHash !== "string") throw new RpcError("decode_failed");
  const finalized = headerNumber(await jsonRpc(url, "chain_getHeader", [finalizedHash], opts));
  return { best, finalized, lag: Math.max(0, best - finalized) };
}

async function blockTimestampMs(url: string, number: number, opts: RpcOptions): Promise<bigint> {
  const hash = await jsonRpc(url, "chain_getBlockHash", [number], opts);
  if (typeof hash !== "string") throw new RpcError("decode_failed");
  const raw = await jsonRpc(url, "state_getStorageAt", [timestampNowKey(), hash], opts);
  const v = typeof raw === "string" ? decodeUintLE(raw) : null;
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

export type BlockTime = { blockSeconds: number; sample: number };

/**
 * Время блока замером, а не чтением константы рантайма: заявленная константа и
 * фактическая скорость расходятся, а продавцу важна фактическая.
 */
export async function measureBlockSeconds(
  url: string,
  bestNumber: number,
  sample: number,
  opts: RpcOptions = {},
): Promise<BlockTime> {
  const from = bestNumber - sample;
  if (!Number.isInteger(sample) || sample <= 0 || from < 1) throw new RpcError("decode_failed");
  const [tNew, tOld] = await Promise.all([
    blockTimestampMs(url, bestNumber, opts),
    blockTimestampMs(url, from, opts),
  ]);
  // Часы узла, пошедшие назад, дали бы отрицательное время блока — это сбой, а
  // не факт о сети.
  if (tNew <= tOld) throw new RpcError("decode_failed");
  const seconds = Number(tNew - tOld) / sample / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RpcError("decode_failed");
  return { blockSeconds: Math.round(seconds * 100) / 100, sample };
}

export type RuntimeVersion = {
  specName: string;
  specVersion: number;
  transactionVersion: number;
};

export async function readRuntimeVersion(
  url: string,
  opts: RpcOptions = {},
): Promise<RuntimeVersion> {
  const raw = await jsonRpc(url, "state_getRuntimeVersion", [], opts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RpcError("decode_failed");
  const v = raw as Record<string, unknown>;
  if (
    typeof v.specName !== "string" ||
    typeof v.specVersion !== "number" ||
    typeof v.transactionVersion !== "number"
  ) {
    throw new RpcError("decode_failed");
  }
  return {
    specName: v.specName,
    specVersion: v.specVersion,
    transactionVersion: v.transactionVersion,
  };
}

export type TransferFee = {
  /** Комиссия в наименьших единицах. */
  planck: bigint;
  /** Та же комиссия в монетах. */
  tokens: number;
  /** Понадобился ли байт расширения `CheckMetadataHash`. */
  metadataHashMode: boolean;
};

/** Эталонный перевод: одна целая монета на обычный адрес, keep-alive. */
const REFERENCE_DEST = new Uint8Array(32).fill(0x11);

function partialFee(raw: unknown): bigint | null {
  if (!raw || typeof raw !== "object") return null;
  const fee = (raw as { partialFee?: unknown }).partialFee;
  if (typeof fee === "number") return BigInt(Math.trunc(fee));
  if (typeof fee !== "string" || !/^\d+$/.test(fee)) return null;
  return BigInt(fee);
}

/**
 * Комиссия эталонного перевода: считает сам узел, мы только собираем байты.
 *
 * Набор подписанных расширений у сетей разный (`CheckMetadataHash` есть у
 * Polkadot и Kusama, нет у Taler), а экстринсик с неверным набором не
 * декодируется вообще — поэтому вариант подбирается попыткой. Отказ узла в
 * декодировании приходит как `rpc_error`, и только после обоих вариантов
 * превращается в `decode_failed`.
 */
export async function queryTransferFee(args: {
  url: string;
  pallet: number;
  decimals: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
}): Promise<TransferFee> {
  const { url, pallet, decimals } = args;
  const opts: RpcOptions = {
    fetchImpl: args.fetchImpl,
    timeoutMs: args.timeoutMs,
    retries: args.retries,
  };
  const value = BigInt(10) ** BigInt(Math.max(0, decimals));
  const call = transferKeepAliveCall({ pallet, dest: REFERENCE_DEST, value });

  for (const metadataHashMode of [false, true]) {
    const ext = fakeSignedExtrinsic({ call, metadataHashMode });
    let raw: unknown;
    try {
      raw = await jsonRpc(url, "payment_queryInfo", [ext], opts);
    } catch (err) {
      // Узел не ответил вовсе — подбирать варианты бессмысленно.
      if (err instanceof RpcError && err.code !== "rpc_error") throw err;
      continue;
    }
    const planck = partialFee(raw);
    if (planck == null) continue;
    return {
      planck,
      tokens: Number(planck) / Number(value),
      metadataHashMode,
    };
  }
  throw new RpcError("decode_failed", "payment_queryInfo");
}
