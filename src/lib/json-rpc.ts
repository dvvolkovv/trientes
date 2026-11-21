/**
 * JSON-RPC поверх инъектируемого fetch. Отдельный файл, потому что чтение сети
 * должно тестироваться без сети, а классификация сбоя попадает в карточку как
 * `checkError` — значит она часть контракта, а не деталь.
 *
 * Выделено из `evm-rpc.ts` в слайсе S: у Substrate результат — объект, а не
 * hex-строка, и копировать транспорт во второй файл значило бы дважды
 * поддерживать одну и ту же классификацию сбоев.
 */

import { withRpcRetry, type RetryPolicy } from "./rpc-retry";

export type FetchLike = (
  input: string,
  init?: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RpcErrorCode = "rpc_unreachable" | "rpc_error" | "decode_failed";

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  /**
   * Чем именно кончилось: «http 525», «not_json», текст обрыва. Хранится
   * полем, а не только в тексте сообщения: по нему `bitcoin-rest` отличает
   * быстрый отказ (статус ответа) от медленного (обрыв, таймаут) — им дано
   * разное число повторов.
   */
  readonly detail?: string;
  constructor(code: RpcErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

export type RpcOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
} & RetryPolicy;

async function once(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RpcError("rpc_unreachable", err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) throw new RpcError("rpc_unreachable", `http ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RpcError("decode_failed");
  }
  if (!body || typeof body !== "object") throw new RpcError("decode_failed");
  const payload = body as { result?: unknown; error?: { message?: string } };
  // Ответ узла «такой функции нет» — это не сбой связи, а факт о контракте.
  if (payload.error) throw new RpcError("rpc_error", payload.error.message);
  if (payload.result === undefined) throw new RpcError("decode_failed");
  return payload.result;
}

/**
 * Повторы — по общему правилу `withRpcRetry`: быстрый отказ (у публичного узла
 * это 429 или 5xx от балансировщика) пережидается окном времени с паузой,
 * медленный получает одну попытку. До уборки BR повтор был один и немедленный,
 * и живой прогон 21 ноября записал Moonriver как `rpc_unreachable` при узле,
 * который тем же методом отвечает за 0,3 с.
 */
export async function jsonRpc(
  url: string,
  method: string,
  params: unknown[] = [],
  opts: RpcOptions = {},
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  return withRpcRetry(() => once(url, method, params, fetchImpl, timeoutMs), opts);
}
