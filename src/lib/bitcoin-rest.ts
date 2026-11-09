/**
 * Чтение цепи семьи Bitcoin (слайс Y) поверх инъектируемого fetch.
 *
 * Отдельный файл, а не ветка в `cosmos-rest`: у Esplora часть ответов приходит
 * обычным текстом (высота головы — `975183`, хэш блока — голая строка), и
 * разбор JSON на них падает. Общее с прежними семьями одно — классификация
 * сбоя из `json-rpc`, потому что её код попадает в карточку как `checkError`,
 * то есть часть контракта.
 *
 * Правило классификации здесь своё и важное: **4xx — это ответ узла**
 * (`rpc_error`, повторять нечего), **5xx и обрыв — связь** (`rpc_unreachable`,
 * один повтор). У Litecoin нет `/fee-estimates`, узел отвечает 404 с текстом
 * `endpoint does not exist`; со правилом Cosmos («не ok — значит недоступен»)
 * это выглядело бы как молчащий узел и роняло бы все факты цепи — ровно та
 * ошибка, которую слайс W поймал на Neutron.
 *
 * Формы ответов проверены живыми запросами 9 ноября 2026.
 */

import { type BitcoinChain } from "./bitcoin-chains";
import { RpcError } from "./json-rpc";

export type TextFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type BitcoinHttpOptions = {
  fetchImpl?: TextFetch;
  timeoutMs?: number;
  /** Один повтор по умолчанию: публичный узел любит отдавать 429 и 502. */
  retries?: number;
};

async function once(url: string, fetchImpl: TextFetch, timeoutMs: number): Promise<string> {
  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json, text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RpcError("rpc_unreachable", err instanceof Error ? err.message : undefined);
  }

  let body: string;
  try {
    body = await res.text();
  } catch {
    throw new RpcError("rpc_unreachable", `http ${res.status}`);
  }

  if (!res.ok) {
    // 429 — это «приходи позже», то есть связь, а не суждение о цепи.
    const connectionLike = res.status >= 500 || res.status === 429;
    throw new RpcError(connectionLike ? "rpc_unreachable" : "rpc_error", `http ${res.status}`);
  }
  return body;
}

/** Текстовый ответ: высота головы и хэш блока приходят без JSON. */
export async function httpGetText(url: string, opts: BitcoinHttpOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as TextFetch);
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

export async function httpGetJson(url: string, opts: BitcoinHttpOptions = {}): Promise<unknown> {
  const body = await httpGetText(url, opts);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // Узел ответил 200, но не JSON: это страница балансировщика или проверка на
    // бота. Факта о сети здесь нет.
    throw new RpcError("rpc_unreachable", "not_json");
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") throw new RpcError("decode_failed");
  return v as Record<string, unknown>;
}

const HASH64 = /^[0-9a-f]{64}$/;

function asHash(raw: string): string {
  const hash = raw.trim().toLowerCase();
  if (!HASH64.test(hash)) throw new RpcError("decode_failed", "not_a_hash");
  return hash;
}

/* ─── блок ────────────────────────────────────────────────────────────────── */

export type BitcoinBlock = {
  hash: string;
  height: number;
  timeMs: number;
};

/** Голова цепи: высота, хэш и время. */
export async function readBitcoinTip(
  chain: BitcoinChain,
  baseUrl: string,
  opts: BitcoinHttpOptions = {},
): Promise<BitcoinBlock> {
  if (chain.api === "BLOCKCYPHER") {
    const raw = asRecord(await httpGetJson(baseUrl, opts));
    const height = Number(raw.height);
    const timeMs = Date.parse(String(raw.time));
    if (!Number.isFinite(height) || !Number.isFinite(timeMs)) throw new RpcError("decode_failed");
    return { hash: asHash(String(raw.hash)), height, timeMs };
  }
  const height = Number((await httpGetText(`${baseUrl}/blocks/tip/height`, opts)).trim());
  if (!Number.isFinite(height) || height <= 0) throw new RpcError("decode_failed");
  return readBitcoinBlockAt(chain, baseUrl, height, opts);
}

/**
 * Блок по высоте. У Esplora это два запроса (высота → хэш → блок), у
 * BlockCypher один; разница спрятана здесь, чтобы прогон фактов её не знал.
 */
export async function readBitcoinBlockAt(
  chain: BitcoinChain,
  baseUrl: string,
  height: number,
  opts: BitcoinHttpOptions = {},
): Promise<BitcoinBlock> {
  if (chain.api === "BLOCKCYPHER") {
    const raw = asRecord(await httpGetJson(`${baseUrl}/blocks/${height}`, opts));
    const timeMs = Date.parse(String(raw.time));
    const got = Number(raw.height);
    if (!Number.isFinite(timeMs) || got !== height) throw new RpcError("decode_failed");
    return { hash: asHash(String(raw.hash)), height, timeMs };
  }
  const hash = asHash(await httpGetText(`${baseUrl}/block-height/${height}`, opts));
  const raw = asRecord(await httpGetJson(`${baseUrl}/block/${hash}`, opts));
  const timestamp = Number(raw.timestamp);
  const got = Number(raw.height);
  if (!Number.isFinite(timestamp) || got !== height) throw new RpcError("decode_failed");
  return { hash, height, timeMs: timestamp * 1000 };
}

/** Хэш блока нужной высоты — идентичность цепи и контрольная точка форка. */
export async function readBitcoinBlockHash(
  chain: BitcoinChain,
  baseUrl: string,
  height: number,
  opts: BitcoinHttpOptions = {},
): Promise<string> {
  if (chain.api === "BLOCKCYPHER") {
    const raw = asRecord(await httpGetJson(`${baseUrl}/blocks/${height}`, opts));
    return asHash(String(raw.hash));
  }
  return asHash(await httpGetText(`${baseUrl}/block-height/${height}`, opts));
}

/**
 * Время блока — замер, а не константа: берём два заголовка и делим разницу
 * времени на разницу высот (так же в слайсах S и V). В PoW временную метку
 * ставит майнер и она гуляет, поэтому выборка берётся большой, а номер блока
 * замера попадает в карточку рядом с числом.
 */
export async function measureBitcoinBlockSeconds(
  chain: BitcoinChain,
  baseUrl: string,
  best: BitcoinBlock,
  span: number,
  opts: BitcoinHttpOptions = {},
): Promise<{ blockSeconds: number; sample: number }> {
  const sample = Math.max(1, Math.min(span, best.height - 1));
  const past = await readBitcoinBlockAt(chain, baseUrl, best.height - sample, opts);
  const seconds = (best.timeMs - past.timeMs) / 1000 / sample;
  if (!(seconds > 0)) throw new RpcError("decode_failed");
  return { blockSeconds: Math.round(seconds * 100) / 100, sample };
}

/* ─── комиссия ────────────────────────────────────────────────────────────── */

/**
 * Какую оценку взять из карты `/fee-estimates` (ключ — число блоков). Точного
 * ключа может не быть, поэтому берётся ближайший сверху, а если таких нет —
 * самый дальний: оценка на больший срок не завышает комиссию.
 */
export function pickFeeEstimate(raw: unknown, targetBlocks: number): number | null {
  if (!raw || typeof raw !== "object") return null;
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => [Number(k), Number(v)] as const)
    .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v) && v > 0)
    .sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return null;
  const atOrAfter = entries.find(([k]) => k >= targetBlocks);
  return (atOrAfter ?? entries[entries.length - 1])[1];
}

/**
 * Цена за байт в сатоши/vB по оценке самого узла.
 *
 * Esplora: сначала `/v1/fees/recommended` (форк mempool.space — у Bitcoin и
 * Litecoin), при 4xx — `/fee-estimates` (у DigiByte только он). BlockCypher:
 * `medium_fee_per_kb` из корня, делённые на 1000.
 *
 * `null` означает «узел оценку не дал» — это не сбой чтения цепи, и остальные
 * факты из-за него не теряются.
 */
export async function readBitcoinFeeRate(
  chain: BitcoinChain,
  baseUrl: string,
  opts: BitcoinHttpOptions = {},
): Promise<number | null> {
  if (chain.api === "BLOCKCYPHER") {
    const raw = asRecord(await httpGetJson(baseUrl, opts));
    const perKb = Number(raw.medium_fee_per_kb);
    if (!Number.isFinite(perKb) || perKb <= 0) return null;
    return perKb / 1000;
  }

  try {
    const raw = asRecord(await httpGetJson(`${baseUrl}/v1/fees/recommended`, opts));
    const rate = Number(raw.halfHourFee);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    // 4xx — у этого узла такого запроса нет; дальше пробуем второй.
    if (!(err instanceof RpcError) || err.code !== "rpc_error") throw err;
  }

  try {
    const raw = await httpGetJson(`${baseUrl}/fee-estimates`, opts);
    return pickFeeEstimate(raw, chain.feeTargetBlocks);
  } catch (err) {
    if (err instanceof RpcError && err.code === "rpc_error") return null;
    throw err;
  }
}

/**
 * Комиссия эталонного перевода в сатоши: цена за байт от узла × размер из
 * реестра (один вход, два выхода). Округление вверх — кошелёк платит целыми
 * сатоши и округляет так же.
 */
export function transferFeeSats(feeRatePerVb: number, txVsize: number): bigint {
  return BigInt(Math.ceil(feeRatePerVb * txVsize));
}
