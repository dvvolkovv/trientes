/**
 * Чтение сети на Cosmos SDK поверх инъектируемого fetch (слайс V).
 *
 * Отдельный файл, а не ветка в `substrate-rpc`: у Cosmos не JSON-RPC, а REST,
 * и ответы приходят обычным JSON по GET. Общего с Substrate здесь только одно —
 * классификация сбоя, и она переиспользуется из `json-rpc`, потому что
 * попадает в карточку как `checkError`, то есть часть контракта.
 *
 * Все адреса и формы ответов проверены живыми запросами 9 ноября 2026.
 */

import { RpcError } from "./json-rpc";

export type HttpFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type HttpOptions = {
  fetchImpl?: HttpFetch;
  timeoutMs?: number;
  /** Одна повторная попытка по умолчанию: публичный узел любит отдавать 429. */
  retries?: number;
};

async function once(url: string, fetchImpl: HttpFetch, timeoutMs: number): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RpcError("rpc_unreachable", err instanceof Error ? err.message : undefined);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Узел ответил не-JSON: часть публичных REST-узлов отдаёт HTML-страницу
    // балансировщика. Это сбой связи, а не факт о сети.
    throw new RpcError("rpc_unreachable", `http ${res.status}`);
  }
  if (!body || typeof body !== "object") throw new RpcError("decode_failed");

  // Отказ самого модуля («такого денома нет») приходит телом с кодом и
  // сообщением. Это ответ о сети, а не обрыв связи, и повторять его незачем.
  const err = body as { code?: unknown; message?: unknown };
  if (typeof err.code === "number" && typeof err.message === "string") {
    throw new RpcError("rpc_error", err.message);
  }
  if (!res.ok) throw new RpcError("rpc_unreachable", `http ${res.status}`);
  return body;
}

export async function httpGetJson(url: string, opts: HttpOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as HttpFetch);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = opts.retries ?? 1;

  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, fetchImpl, timeoutMs);
    } catch (e) {
      last = e;
      if (!(e instanceof RpcError) || e.code !== "rpc_unreachable") throw e;
    }
  }
  throw last instanceof Error ? last : new RpcError("rpc_unreachable");
}

/* ─── блок ────────────────────────────────────────────────────────────────── */

export type CosmosBlock = {
  /** Идентичность сети в Cosmos — это chain-id, а не хэш генезиса: блок 1 на
   *  обрезанных узлах недоступен, а chain-id отдаёт любой узел. */
  chainId: string;
  height: number;
  timeMs: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") throw new RpcError("decode_failed");
  return v as Record<string, unknown>;
}

export async function readCosmosBlock(
  baseUrl: string,
  height: number | "latest" = "latest",
  opts: HttpOptions = {},
): Promise<CosmosBlock> {
  const raw = await httpGetJson(
    `${baseUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`,
    opts,
  );
  const header = asRecord(asRecord(asRecord(raw).block).header);
  const chainId = header.chain_id;
  const h = Number(header.height);
  const timeMs = Date.parse(String(header.time));
  if (typeof chainId !== "string" || !Number.isFinite(h) || !Number.isFinite(timeMs)) {
    throw new RpcError("decode_failed");
  }
  return { chainId, height: h, timeMs };
}

/**
 * Время блока — замер, а не константа из рантайма: берём два заголовка и делим
 * разницу времени на разницу высот. Так же сделано для Substrate (слайс S).
 */
export async function measureCosmosBlockSeconds(
  baseUrl: string,
  best: CosmosBlock,
  span: number,
  opts: HttpOptions = {},
): Promise<{ blockSeconds: number; sample: number }> {
  const sample = Math.max(1, Math.min(span, best.height - 1));
  const past = await readCosmosBlock(baseUrl, best.height - sample, opts);
  const seconds = (best.timeMs - past.timeMs) / 1000 / sample;
  if (!(seconds > 0)) throw new RpcError("decode_failed");
  return { blockSeconds: Math.round(seconds * 100) / 100, sample };
}

/* ─── выпуск ──────────────────────────────────────────────────────────────── */

/** Общий выпуск денома в наименьших единицах. */
export async function readCosmosSupply(
  baseUrl: string,
  denom: string,
  opts: HttpOptions = {},
): Promise<bigint> {
  const raw = await httpGetJson(
    `${baseUrl}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`,
    opts,
  );
  const amount = asRecord(asRecord(raw).amount);
  if (typeof amount.amount !== "string" || !/^\d+$/.test(amount.amount)) {
    throw new RpcError("decode_failed");
  }
  if (amount.denom !== denom) throw new RpcError("decode_failed", "denom_mismatch");
  return BigInt(amount.amount);
}

/* ─── тикер и знаки ───────────────────────────────────────────────────────── */

export type DenomMeta = {
  /** Отображаемый деном в верхнем регистре: utia → TIA. */
  symbol: string | null;
  /** Порядок отображаемого денома: 6 для utia → TIA. */
  exponent: number | null;
};

const UNKNOWN_META: DenomMeta = { symbol: null, exponent: null };

/**
 * Тикер и знаки из реестра денома. Узел знает их не всегда: Injective, Kava и
 * Secret отвечают «client metadata for denom …» — тогда полей просто нет, и
 * реестр остаётся единственным источником. Поднимать это в ошибку нельзя:
 * отсутствие реестра денома — свойство сети, а не сбой чтения.
 *
 * `display` предпочитается полю `symbol`: у Initia в `symbol` лежит базовый
 * деном (`uinit`), а отображаемый — `init`.
 */
export async function readCosmosDenomMeta(
  baseUrl: string,
  denom: string,
  opts: HttpOptions = {},
): Promise<DenomMeta> {
  let raw: unknown;
  try {
    raw = await httpGetJson(
      `${baseUrl}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`,
      opts,
    );
  } catch (err) {
    if (err instanceof RpcError && err.code === "rpc_error") return UNKNOWN_META;
    throw err;
  }
  const meta = asRecord(raw).metadata;
  if (!meta || typeof meta !== "object") return UNKNOWN_META;
  const m = meta as { display?: unknown; symbol?: unknown; denom_units?: unknown };
  const display = typeof m.display === "string" && m.display ? m.display : null;
  const fallback = typeof m.symbol === "string" && m.symbol ? m.symbol : null;
  const name = display ?? fallback;

  let exponent: number | null = null;
  if (Array.isArray(m.denom_units) && name) {
    for (const unit of m.denom_units) {
      if (!unit || typeof unit !== "object") continue;
      const u = unit as { denom?: unknown; exponent?: unknown };
      if (u.denom === name && typeof u.exponent === "number") exponent = u.exponent;
    }
  }
  return { symbol: name ? name.toUpperCase() : null, exponent };
}

/* ─── цена газа ───────────────────────────────────────────────────────────── */

/**
 * Минимальная цена газа, заявленная узлом, в своём деноме.
 *
 * Узел перечисляет цены через запятую и в нескольких деномах:
 * `12500000000.000000000000000000adydx,0.025000000000000000ibc/8E27…`. Нужен
 * свой, и нули в хвосте дроби убираются — иначе в карточке окажется
 * «0.002000000000000000».
 */
export function pickGasPrice(raw: unknown, denom: string): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry.endsWith(denom)) continue;
    const amount = entry.slice(0, entry.length - denom.length);
    if (!/^\d+(\.\d+)?$/.test(amount)) continue;
    const trimmed = amount.includes(".")
      ? amount.replace(/0+$/, "").replace(/\.$/, "")
      : amount;
    return trimmed.length > 0 ? trimmed : "0";
  }
  return null;
}

/**
 * Минимальная цена газа. Запрос `base/node/config` реализован не у всех узлов:
 * Neutron отвечает 501. Это свойство узла, а не сбой чтения сети, поэтому
 * необязательный факт превращается в `null`, а не роняет весь прогон — иначе
 * из-за одного нереализованного запроса карточка теряла бы и время блока, и
 * chain-id, и финальность.
 */
export async function readCosmosMinGasPrice(
  baseUrl: string,
  denom: string,
  opts: HttpOptions = {},
): Promise<string | null> {
  let raw: unknown;
  try {
    raw = await httpGetJson(`${baseUrl}/cosmos/base/node/v1beta1/config`, opts);
  } catch (err) {
    if (err instanceof RpcError && err.code === "rpc_error") return null;
    throw err;
  }
  return pickGasPrice(asRecord(raw).minimum_gas_price, denom);
}
