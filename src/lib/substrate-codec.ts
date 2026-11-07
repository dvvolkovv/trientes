/**
 * Кодек Substrate: ключи хранилища и разбор SCALE. Чистый файл без сети —
 * ровно те вычисления, которые должен проверить тест, а не глаза.
 *
 * Ключи хранилища выводятся, а не вставляются готовым хексом: xxhash64 — это
 * шестьдесят строк, а магическую константу через год невозможно ни
 * перепроверить, ни объяснить. Тест сверяет вывод с опубликованными ключами
 * `Balances.TotalIssuance` и `System.Account`.
 */

import { blake2b } from "@noble/hashes/blake2.js";

const M = (BigInt(1) << BigInt(64)) - BigInt(1);
const P1 = BigInt("11400714785074694791");
const P2 = BigInt("14029467366897019727");
const P3 = BigInt("1609587929392839161");
const P4 = BigInt("9650029242287828579");
const P5 = BigInt("2870177450012600261");

const mul = (a: bigint, b: bigint) => (a * b) & M;
const add = (a: bigint, b: bigint) => (a + b) & M;
const rotl = (v: bigint, r: number) => ((v << BigInt(r)) | (v >> BigInt(64 - r))) & M;

const round = (acc: bigint, val: bigint) => mul(rotl(add(acc, mul(val, P2)), 31), P1);

function mergeRound(acc: bigint, val: bigint): bigint {
  return add(mul(acc ^ round(BigInt(0), val), P1), P4);
}

function readU64(b: Uint8Array, i: number): bigint {
  let v = BigInt(0);
  for (let k = 7; k >= 0; k--) v = (v << BigInt(8)) | BigInt(b[i + k]);
  return v;
}

function readU32(b: Uint8Array, i: number): bigint {
  return BigInt(b[i] + b[i + 1] * 0x100 + b[i + 2] * 0x10000 + b[i + 3] * 0x1000000);
}

/** XXH64 — хеш, на котором Substrate строит префиксы паллет (`twox`). */
export function xxh64(buf: Uint8Array, seed: bigint): bigint {
  const len = buf.length;
  let acc: bigint;
  let i = 0;

  if (len >= 32) {
    let a1 = add(add(seed, P1), P2);
    let a2 = add(seed, P2);
    let a3 = seed;
    let a4 = (seed - P1) & M;
    for (; i <= len - 32; i += 32) {
      a1 = round(a1, readU64(buf, i));
      a2 = round(a2, readU64(buf, i + 8));
      a3 = round(a3, readU64(buf, i + 16));
      a4 = round(a4, readU64(buf, i + 24));
    }
    acc = (rotl(a1, 1) + rotl(a2, 7) + rotl(a3, 12) + rotl(a4, 18)) & M;
    acc = mergeRound(acc, a1);
    acc = mergeRound(acc, a2);
    acc = mergeRound(acc, a3);
    acc = mergeRound(acc, a4);
  } else {
    acc = add(seed, P5);
  }

  acc = add(acc, BigInt(len));
  for (; i <= len - 8; i += 8) {
    acc = add(mul(rotl(acc ^ round(BigInt(0), readU64(buf, i)), 27), P1), P4);
  }
  if (i <= len - 4) {
    acc = add(mul(rotl(acc ^ mul(readU32(buf, i), P1), 23), P2), P3);
    i += 4;
  }
  for (; i < len; i++) {
    acc = mul(rotl(acc ^ mul(BigInt(buf[i]), P5), 11), P1);
  }
  acc ^= acc >> BigInt(33);
  acc = mul(acc, P2);
  acc ^= acc >> BigInt(29);
  acc = mul(acc, P3);
  acc ^= acc >> BigInt(32);
  return acc;
}

export const toHex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

export function fromHex(hex: string): Uint8Array | null {
  const s = (hex ?? "").replace(/^0x/, "");
  if (s.length === 0 || s.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const leHex = (v: bigint): string => {
  let s = "";
  for (let k = 0; k < 8; k++) {
    s += Number((v >> BigInt(8 * k)) & BigInt(0xff))
      .toString(16)
      .padStart(2, "0");
  }
  return s;
};

/** twox128(data) = xxh64(seed 0) ++ xxh64(seed 1), каждый little-endian. */
export function twox128(input: string): string {
  const b = new TextEncoder().encode(input);
  return leHex(xxh64(b, BigInt(0))) + leHex(xxh64(b, BigInt(1)));
}

export const storageKey = (pallet: string, item: string): string =>
  `0x${twox128(pallet)}${twox128(item)}`;

export const totalIssuanceKey = (): string => storageKey("Balances", "TotalIssuance");
export const timestampNowKey = (): string => storageKey("Timestamp", "Now");

/** blake2_128concat: хеш ключа плюс сам ключ — чтобы ключ читался обратно. */
export function systemAccountKey(pubkey: Uint8Array): string {
  return `${storageKey("System", "Account")}${toHex(blake2b(pubkey, { dkLen: 16 }))}${toHex(pubkey)}`;
}

/** Беззнаковое целое из hex little-endian любой длины (u32/u64/u128). */
export function decodeUintLE(hex: string | null | undefined): bigint | null {
  const b = fromHex(hex ?? "");
  if (!b) return null;
  let v = BigInt(0);
  for (let i = b.length - 1; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[i]);
  return v;
}

/**
 * `free + reserved` из `AccountInfo`. Застейканное и забонденное в казне
 * проекта всё равно принадлежит казне и в оборот не входит. `frozen` не
 * трогаем: в нынешнем рантайме это подмножество `free`, и его учёт посчитал бы
 * одни и те же монеты дважды.
 *
 * Отсутствующий счёт (`null`) — это ноль, а не ошибка: адрес просто пуст.
 */
export function decodeAccountBalance(hex: string | null | undefined): bigint | null {
  if (hex == null) return BigInt(0);
  const b = fromHex(hex);
  if (!b) return BigInt(0);
  if (b.length < 48) return null;
  const u128 = (off: number) => {
    let v = BigInt(0);
    for (let i = 15; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[off + i]);
    return v;
  };
  return u128(16) + u128(32);
}

/* ─── SS58 ───────────────────────────────────────────────────────────────── */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(input: string): Uint8Array | null {
  if (!input || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(input)) return null;
  let num = BigInt(0);
  for (const ch of input) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    num = num * BigInt(58) + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num & BigInt(0xff)));
    num >>= BigInt(8);
  }
  // Ведущие «1» в base58 — это ведущие нулевые байты.
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const SS58_PRE = new TextEncoder().encode("SS58PRE");

export type Ss58Parts = { prefix: number; pubkey: Uint8Array };

/**
 * Разбор SS58. Контрольная сумма обязательна: без неё опечатка в адресе казны
 * превратилась бы в «адрес не ответил», то есть в молчаливое занижение
 * исключённого выпуска.
 */
export function ss58Decode(address: string | null | undefined): Ss58Parts | null {
  const raw = base58Decode((address ?? "").trim());
  if (!raw || raw.length < 35) return null;

  // Префикс сети: один байт (<64) или два байта по схеме Substrate.
  let prefix: number;
  let offset: number;
  if (raw[0] < 64) {
    prefix = raw[0];
    offset = 1;
  } else if (raw[0] < 128) {
    const lower = ((raw[0] & 0b0000_0011) << 6) | (raw[1] >> 2);
    const upper = (raw[1] & 0b0000_0011) | ((raw[0] & 0b0011_1111) << 2);
    prefix = lower | (upper << 8);
    offset = 2;
  } else {
    return null;
  }

  const body = raw.slice(0, raw.length - 2);
  const given = raw.slice(raw.length - 2);
  if (body.length - offset !== 32) return null;

  const pre = new Uint8Array(SS58_PRE.length + body.length);
  pre.set(SS58_PRE, 0);
  pre.set(body, SS58_PRE.length);
  const sum = blake2b(pre, { dkLen: 64 });
  if (sum[0] !== given[0] || sum[1] !== given[1]) return null;

  return { prefix, pubkey: body.slice(offset) };
}

/** Адрес разбирается и, если префикс задан, принадлежит именно этой сети. */
export function isSs58Address(
  address: string | null | undefined,
  expectedPrefix?: number,
): boolean {
  const parts = ss58Decode(address);
  if (!parts) return false;
  return expectedPrefix == null || parts.prefix === expectedPrefix;
}
