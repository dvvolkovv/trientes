/**
 * Заморозка выпуска: сколько монет сеть держит под расписанием вестинга.
 *
 * Капитализация считается по обороту, а оборот — это выпуск минус то, чего в
 * обороте нет. У карточки, которую завели мы, списка адресов казны взять
 * негде: проект его не заявлял, а подставлять свой список значило бы считать
 * оборот по словам. Палета `vesting` говорит то же самое числом: у счёта лежит
 * расписание, и до его срока монеты не переводятся вовсе.
 *
 * Поэтому исключением становится не адрес, а сумма всех нераспущенных
 * расписаний сети — один факт, прочитанный у узла, и его может повторить любой
 * читатель тем же обходом хранилища.
 *
 * Метаданных рантайма в проекте нет и здесь они не нужны: запись расписания
 * фиксированной длины (`locked: u128`, `perBlock: u128`, `startingBlock: u32`),
 * а ключ карты — префикс хранилища, который выводится в коде.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";
import { fromHex, storageKey } from "./substrate-codec";

/** Имя хранилища — оно же подпись строки исключения в карточке. */
export const VESTING_STORAGE = "Vesting.Vesting";

/** Ключей за один запрос. Больше публичному узлу отдавать незачем. */
export const VESTING_PAGE = 500;

/**
 * Больше счетов не обходим. Это не экономия, а честность: обход на тысячи
 * страниц публичный узел оборвёт на середине, и неполная сумма занизила бы
 * заморозку, то есть **завысила** оборот и капитализацию. Лучше отказ.
 */
export const MAX_VESTING_ACCOUNTS = 5000;

/** Значений за один `state_queryStorageAt`. */
const VALUE_BATCH = 100;

/** `locked: u128` + `perBlock: u128` + `startingBlock: u32`. */
const SCHEDULE_BYTES = 36;

const ZERO = BigInt(0);

export type VestingSchedule = {
  locked: bigint;
  perBlock: bigint;
  startingBlock: number;
};

export const vestingPrefix = (): string => storageKey("Vesting", "Vesting");

function uintLE(b: Uint8Array, offset: number, length: number): bigint {
  let v = ZERO;
  for (let i = offset + length - 1; i >= offset; i--) v = (v << BigInt(8)) | BigInt(b[i]);
  return v;
}

/**
 * Длина вектора в SCALE-компакте. Четвёртый режим (big-integer) означал бы
 * вектор длиной больше гигазаписи — такого ответа от узла не бывает, и
 * принимать его как длину нельзя.
 */
function compactLength(b: Uint8Array): { count: number; offset: number } {
  if (b.length === 0) throw new RpcError("decode_failed", "vesting_empty");
  const mode = b[0] & 0b11;
  if (mode === 0) return { count: b[0] >> 2, offset: 1 };
  if (mode === 1) {
    if (b.length < 2) throw new RpcError("decode_failed", "vesting_truncated");
    return { count: Number(uintLE(b, 0, 2) >> BigInt(2)), offset: 2 };
  }
  if (mode === 2) {
    if (b.length < 4) throw new RpcError("decode_failed", "vesting_truncated");
    return { count: Number(uintLE(b, 0, 4) >> BigInt(2)), offset: 4 };
  }
  throw new RpcError("decode_failed", "vesting_length_mode");
}

/** Расписания одного счёта. Лишний хвост — повод отказаться, а не отбросить. */
export function decodeVestingSchedules(hex: string | null | undefined): VestingSchedule[] {
  const b = fromHex(hex ?? "");
  if (!b) throw new RpcError("decode_failed", "vesting_hex");
  const { count, offset } = compactLength(b);
  if (b.length !== offset + count * SCHEDULE_BYTES) {
    throw new RpcError("decode_failed", "vesting_length");
  }
  const out: VestingSchedule[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * SCHEDULE_BYTES;
    out.push({
      locked: uintLE(b, o, 16),
      perBlock: uintLE(b, o + 16, 16),
      startingBlock: Number(uintLE(b, o + 32, 4)),
    });
  }
  return out;
}

/**
 * Сколько по этому расписанию ещё заморожено на данном блоке. До начала
 * расписания заморожено всё; дальше распускается по `perBlock` за блок, и
 * ноль — это ноль, а не отрицательная заморозка.
 *
 * `perBlock = locked` — тот самый случай «вся сумма разом в назначенный блок»,
 * и отдельной ветки он не требует.
 */
export function lockedAt(schedule: VestingSchedule, block: number): bigint {
  if (block <= schedule.startingBlock) return schedule.locked;
  const elapsed = BigInt(block - schedule.startingBlock);
  const released = schedule.perBlock * elapsed;
  return released >= schedule.locked ? ZERO : schedule.locked - released;
}

export function totalLockedAt(schedules: readonly VestingSchedule[], block: number): bigint {
  let sum = ZERO;
  for (const s of schedules) sum += lockedAt(s, block);
  return sum;
}

export type VestingLocked = {
  /** Заморожено в минимальных единицах на блоке `block`. */
  units: bigint;
  /** Сколько счетов держат расписания — число для подписи строки расчёта. */
  accounts: number;
  block: number;
};

/**
 * Обход всей карты расписаний. Ключи и значения читаются на **одном** блоке:
 * иначе между страницами могла бы пройти выдача, и сумма относилась бы к двум
 * разным состояниям сети.
 */
export async function readVestingLocked(
  url: string,
  opts: RpcOptions = {},
): Promise<VestingLocked> {
  const at = await jsonRpc(url, "chain_getBlockHash", [], opts);
  if (typeof at !== "string" || !/^0x[0-9a-f]{64}$/i.test(at)) {
    throw new RpcError("decode_failed", "vesting_head");
  }
  const header = await jsonRpc(url, "chain_getHeader", [at], opts);
  const rawNumber = (header as { number?: unknown } | null)?.number;
  const block = typeof rawNumber === "string" ? Number.parseInt(rawNumber, 16) : NaN;
  if (!Number.isFinite(block)) throw new RpcError("decode_failed", "vesting_header");

  const prefix = vestingPrefix();
  const keys: string[] = [];
  let startKey: string | null = null;
  for (;;) {
    const page = await jsonRpc(url, "state_getKeysPaged", [prefix, VESTING_PAGE, startKey, at], opts);
    if (!Array.isArray(page)) throw new RpcError("decode_failed", "vesting_keys");
    for (const k of page) {
      if (typeof k !== "string") throw new RpcError("decode_failed", "vesting_key");
      keys.push(k);
    }
    if (page.length < VESTING_PAGE) break;
    if (keys.length > MAX_VESTING_ACCOUNTS) {
      throw new RpcError("decode_failed", "vesting_too_many");
    }
    startKey = keys[keys.length - 1];
  }

  let units = ZERO;
  for (let i = 0; i < keys.length; i += VALUE_BATCH) {
    const batch = keys.slice(i, i + VALUE_BATCH);
    const res = await jsonRpc(url, "state_queryStorageAt", [batch, at], opts);
    const changes = Array.isArray(res) ? (res[0] as { changes?: unknown })?.changes : null;
    if (!Array.isArray(changes)) throw new RpcError("decode_failed", "vesting_values");
    if (changes.length !== batch.length) throw new RpcError("decode_failed", "vesting_partial");
    for (const change of changes) {
      const value = Array.isArray(change) ? change[1] : null;
      // Ключ без значения — гонка с выдачей на другом блоке; на закреплённом
      // блоке такого быть не должно, и молча считать его нулём нельзя.
      if (typeof value !== "string") throw new RpcError("decode_failed", "vesting_value");
      units += totalLockedAt(decodeVestingSchedules(value), block);
    }
  }

  return { units, accounts: keys.length, block };
}
