/**
 * JSON-RPC поверх инъектируемого fetch. Отдельный файл, потому что сверка
 * контрактов должна тестироваться без сети, а классификация сбоя попадает
 * в карточку как `checkError` — значит она часть контракта, а не деталь.
 */

export type FetchLike = (
  input: string,
  init?: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RpcErrorCode = "rpc_unreachable" | "rpc_error" | "decode_failed";

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  constructor(code: RpcErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export type RpcOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Одна повторная попытка по умолчанию: публичный узел любит отдавать 429. */
  retries?: number;
};

async function once(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string> {
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
  if (typeof payload.result !== "string") throw new RpcError("decode_failed");
  return payload.result;
}

export async function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  opts: RpcOptions = {},
): Promise<string> {
  const fetchImpl = (opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = opts.retries ?? 1;

  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, method, params, fetchImpl, timeoutMs);
    } catch (err) {
      last = err;
      // Повторять смысл есть только при обрыве связи: rpc_error воспроизведётся.
      if (!(err instanceof RpcError) || err.code !== "rpc_unreachable") throw err;
    }
  }
  throw last instanceof Error ? last : new RpcError("rpc_unreachable");
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
