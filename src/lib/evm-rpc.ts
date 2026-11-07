/**
 * EVM-обёртки над общим JSON-RPC: у `eth_*` результат всегда hex-строка, и
 * остальной код слайса B на это рассчитывает. Транспорт и классификация сбоев
 * живут в `json-rpc.ts` — их делит с чтением Substrate (слайс S).
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";

export { RpcError } from "./json-rpc";
export type { FetchLike, RpcErrorCode, RpcOptions } from "./json-rpc";

export async function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  opts: RpcOptions = {},
): Promise<string> {
  const result = await jsonRpc(url, method, params, opts);
  if (typeof result !== "string") throw new RpcError("decode_failed");
  return result;
}

export function ethCall(
  url: string,
  address: string,
  data: string,
  opts: RpcOptions = {},
): Promise<string> {
  return rpcCall(url, "eth_call", [{ to: address, data }, "latest"], opts);
}

export function ethGetCode(url: string, address: string, opts: RpcOptions = {}): Promise<string> {
  return rpcCall(url, "eth_getCode", [address, "latest"], opts);
}

export function ethGetStorageAt(
  url: string,
  address: string,
  slot: string,
  opts: RpcOptions = {},
): Promise<string> {
  return rpcCall(url, "eth_getStorageAt", [address, slot, "latest"], opts);
}
