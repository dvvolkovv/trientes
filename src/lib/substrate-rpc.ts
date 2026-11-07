/**
 * Типизированные чтения Substrate-узла. Каждая функция отвечает за один факт и
 * бросает `RpcError` с теми же кодами, что уже умеет слайс B: коды попадают в
 * карточку как `checkError`, и общий словарь важнее удобства.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";
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

export async function readChainProperties(
  url: string,
  opts: RpcOptions = {},
): Promise<ChainProperties> {
  const raw = await jsonRpc(url, "system_properties", [], opts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RpcError("decode_failed");
  const p = raw as Record<string, unknown>;
  const decimals = firstOf(p.tokenDecimals);
  const symbol = firstOf(p.tokenSymbol);
  const prefix = p.ss58Format;
  return {
    decimals: typeof decimals === "number" ? decimals : null,
    symbol: typeof symbol === "string" ? symbol : null,
    ss58Format: typeof prefix === "number" ? prefix : null,
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
