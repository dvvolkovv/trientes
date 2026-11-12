/**
 * Что в сети нельзя перевести: блокировки балансов.
 *
 * Капитализация считается по обороту, а оборот — это выпуск минус то, чего в
 * обороте нет. Слайс AC вычитал только вестинг (`Vesting.Vesting`), но у сети
 * на Substrate есть и вторая заморозка — стейкинг: монеты, отданные в залог
 * валидатору, со счёта не уходят.
 *
 * Складывать два вычета нельзя. Сеть не суммирует блокировки, а берёт
 * **наибольшую**: у счёта один свободный баланс, и каждая блокировка говорит,
 * сколько его трогать нельзя. Живой обход Taler 12 ноября это и показал —
 * вестингом заперто 1 088 888 878 TAL, в стейкинге 1 088 963 410 TAL, а
 * неподвижно всего 1 088 963 410: это одни и те же монеты, заложенные тем же
 * счётом. Вычти мы стейкинг отдельной строкой — вычли бы их дважды.
 *
 * Поэтому исключением становится не вид заморозки, а то, что сеть считает
 * неподвижным: сумма максимумов по счетам карты `Balances.Locks`. Один факт,
 * охватывающий вестинг, стейкинг и любую будущую блокировку, и его может
 * повторить любой читатель тем же обходом.
 *
 * Метаданных рантайма здесь не нужно: запись блокировки фиксированной длины
 * (`id: [u8;8]`, `amount: u128`, `reasons: u8`), а ключ карты выводится в коде.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";
import { fromHex, storageKey } from "./substrate-codec";

/** Имя хранилища — оно же подпись строки исключения в карточке. */
export const LOCKS_STORAGE = "Balances.Locks";

/** Ключей за один запрос. Больше публичному узлу отдавать незачем. */
export const LOCKS_PAGE = 500;

/**
 * Больше счетов не обходим. Это не экономия, а честность: обход на тысячи
 * страниц публичный узел оборвёт на середине, и неполная сумма занизила бы
 * заморозку, то есть **завысила** оборот и капитализацию. Лучше отказ.
 */
export const MAX_LOCK_ACCOUNTS = 5000;

/** Значений за один `state_queryStorageAt`. */
const VALUE_BATCH = 100;

/** `id: [u8;8]` + `amount: u128` + `reasons: u8`. */
const LOCK_BYTES = 25;

const ZERO = BigInt(0);

export type BalanceLock = {
  /** Имя блокировки, как её называет палета: `staking`, `vesting`, … */
  id: string;
  units: bigint;
};

export const locksPrefix = (): string => storageKey("Balances", "Locks");

function uintLE(b: Uint8Array, offset: number, length: number): bigint {
  let v = ZERO;
  for (let i = offset + length - 1; i >= offset; i--) v = (v << BigInt(8)) | BigInt(b[i]);
  return v;
}

/**
 * Длина вектора в SCALE-компакте. Четвёртый режим (big-integer) означал бы
 * вектор длиной больше гигазаписи — такого ответа от узла не бывает.
 */
function compactLength(b: Uint8Array): { count: number; offset: number } {
  if (b.length === 0) throw new RpcError("decode_failed", "locks_empty");
  const mode = b[0] & 0b11;
  if (mode === 0) return { count: b[0] >> 2, offset: 1 };
  if (mode === 1) {
    if (b.length < 2) throw new RpcError("decode_failed", "locks_truncated");
    return { count: Number(uintLE(b, 0, 2) >> BigInt(2)), offset: 2 };
  }
  if (mode === 2) {
    if (b.length < 4) throw new RpcError("decode_failed", "locks_truncated");
    return { count: Number(uintLE(b, 0, 4) >> BigInt(2)), offset: 4 };
  }
  throw new RpcError("decode_failed", "locks_length_mode");
}

/** Блокировки одного счёта. Лишний хвост — повод отказаться, а не отбросить. */
export function decodeBalanceLocks(hex: string | null | undefined): BalanceLock[] {
  const b = fromHex(hex ?? "");
  if (!b) throw new RpcError("decode_failed", "locks_hex");
  const { count, offset } = compactLength(b);
  if (b.length !== offset + count * LOCK_BYTES) {
    throw new RpcError("decode_failed", "locks_length");
  }
  const out: BalanceLock[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * LOCK_BYTES;
    // Имя блокировки — восемь байт ASCII, добитых **пробелами** (живая запись
    // Taler: `staking ` и `vesting `), а у иных палет нулями. Добивку убираем,
    // иначе имя уедет в подпись строки расчёта вместе с хвостом.
    let id = "";
    for (let j = o; j < o + 8; j++) if (b[j] !== 0) id += String.fromCharCode(b[j]);
    id = id.trim();
    out.push({ id, units: uintLE(b, o + 8, 16) });
  }
  return out;
}

/**
 * Сколько у счёта неподвижно. Блокировки перекрываются, поэтому берётся
 * наибольшая: сумма сказала бы, что счёт держит больше монет, чем у него есть.
 */
export function accountFrozen(locks: readonly BalanceLock[]): bigint {
  let max = ZERO;
  for (const l of locks) if (l.units > max) max = l.units;
  return max;
}

export type LockedSupply = {
  /** Неподвижно в минимальных единицах на блоке `block`. */
  units: bigint;
  /** Сколько счетов держат блокировки — число для подписи строки расчёта. */
  accounts: number;
  /** Виды блокировок, от большей суммы к меньшей: `staking`, `vesting`, … */
  reasons: string[];
  block: number;
};

/**
 * Обход всей карты блокировок. Ключи и значения читаются на **одном** блоке:
 * иначе между страницами мог бы пройти перевод, и сумма относилась бы к двум
 * разным состояниям сети.
 */
export async function readLockedSupply(url: string, opts: RpcOptions = {}): Promise<LockedSupply> {
  const at = await jsonRpc(url, "chain_getBlockHash", [], opts);
  if (typeof at !== "string" || !/^0x[0-9a-f]{64}$/i.test(at)) {
    throw new RpcError("decode_failed", "locks_head");
  }
  const header = await jsonRpc(url, "chain_getHeader", [at], opts);
  const rawNumber = (header as { number?: unknown } | null)?.number;
  const block = typeof rawNumber === "string" ? Number.parseInt(rawNumber, 16) : NaN;
  if (!Number.isFinite(block)) throw new RpcError("decode_failed", "locks_header");

  const prefix = locksPrefix();
  const keys: string[] = [];
  let startKey: string | null = null;
  for (;;) {
    const page = await jsonRpc(url, "state_getKeysPaged", [prefix, LOCKS_PAGE, startKey, at], opts);
    if (!Array.isArray(page)) throw new RpcError("decode_failed", "locks_keys");
    for (const k of page) {
      if (typeof k !== "string") throw new RpcError("decode_failed", "locks_key");
      keys.push(k);
    }
    if (page.length < LOCKS_PAGE) break;
    if (keys.length > MAX_LOCK_ACCOUNTS) throw new RpcError("decode_failed", "locks_too_many");
    startKey = keys[keys.length - 1];
  }

  let units = ZERO;
  const byReason = new Map<string, bigint>();
  for (let i = 0; i < keys.length; i += VALUE_BATCH) {
    const batch = keys.slice(i, i + VALUE_BATCH);
    const res = await jsonRpc(url, "state_queryStorageAt", [batch, at], opts);
    const changes = Array.isArray(res) ? (res[0] as { changes?: unknown })?.changes : null;
    if (!Array.isArray(changes)) throw new RpcError("decode_failed", "locks_values");
    if (changes.length !== batch.length) throw new RpcError("decode_failed", "locks_partial");
    for (const change of changes) {
      const value = Array.isArray(change) ? change[1] : null;
      // Ключ без значения — гонка с переводом на другом блоке; на закреплённом
      // блоке такого быть не должно, и молча считать его нулём нельзя.
      if (typeof value !== "string") throw new RpcError("decode_failed", "locks_value");
      const locks = decodeBalanceLocks(value);
      units += accountFrozen(locks);
      for (const l of locks) byReason.set(l.id, (byReason.get(l.id) ?? ZERO) + l.units);
    }
  }

  const reasons = [...byReason.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id]) => id);
  return { units, accounts: keys.length, reasons, block };
}
