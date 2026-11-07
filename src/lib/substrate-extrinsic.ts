/**
 * Сборка экстринсика для расчёта комиссии (слайс T). Чистые функции, без сети.
 *
 * Зачем вообще собирать экстринсик: формула комиссии живёт в рантайме сети
 * (полином `WeightToFee`, множитель `NextFeeMultiplier`) и меняется без
 * предупреждения, поэтому считает её узел — ему нужны готовые байты.
 *
 * Почему подписанный, а не простой: неподписанный экстринсик бесплатен, узел на
 * него отвечает `partialFee: "0"` — платит подписант, которого там нет. Подпись
 * при расчёте комиссии не проверяется, но её байты входят в длину, а длина
 * входит в комиссию. Поэтому подпись здесь — пустышка, и подписывать
 * по-настоящему этот файл не умеет: отправкой экстринсиков проект не занимается.
 */

import { toHex } from "./substrate-codec";

/** Индекс `transfer_keep_alive` в палете балансов: 3 и до переименования
 * `transfer` → `transfer_allow_death`, и после. */
export const TRANSFER_KEEP_ALIVE_CALL = 3;

/** Тело подписанного экстринсика: версия 4 со старшим битом «подписан». */
const SIGNED_VERSION = 0x84;
/** `MultiAddress::Id` — вариант 0, 32 байта публичного ключа. */
const MULTIADDRESS_ID = 0x00;
/** `MultiSignature::Sr25519` — вариант 1, 64 байта. */
const MULTISIGNATURE_SR25519 = 0x01;
/** Бессмертная эра: одним байтом. */
const ERA_IMMORTAL = 0x00;

const DUMMY_SIGNER = new Uint8Array(32).fill(0x22);
const DUMMY_SIGNATURE = new Uint8Array(64).fill(0x33);

/** SCALE compact: четыре режима по двум младшим битам. */
const ZERO = BigInt(0);
const BYTE = BigInt(0xff);
const EIGHT = BigInt(8);
const SINGLE_MAX = BigInt(64);
const TWO_BYTE_MAX = BigInt(1) << BigInt(14);
const FOUR_BYTE_MAX = BigInt(1) << BigInt(30);

export function compactEncode(value: bigint): Uint8Array {
  if (value < ZERO) throw new Error("compact_negative");
  if (value < SINGLE_MAX) return new Uint8Array([Number(value) << 2]);
  if (value < TWO_BYTE_MAX) {
    const v = (Number(value) << 2) | 0b01;
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  }
  if (value < FOUR_BYTE_MAX) {
    const v = (Number(value) << 2) | 0b10;
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
  }
  const le: number[] = [];
  for (let v = value; v > ZERO; v >>= EIGHT) le.push(Number(v & BYTE));
  if (le.length > 67) throw new Error("compact_too_large");
  return new Uint8Array([((le.length - 4) << 2) | 0b11, ...le]);
}

const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};

/**
 * Вызов `Balances.transfer_keep_alive(dest, value)`. Индекс палеты — из реестра
 * сетей: в метаданных он есть, но добраться до него значит написать декодер
 * реестра типов, поэтому индекс пришпилен и охраняется `transactionVersion`.
 */
export function transferKeepAliveCall(args: {
  pallet: number;
  dest: Uint8Array;
  value: bigint;
}): Uint8Array {
  if (!Number.isInteger(args.pallet) || args.pallet < 0 || args.pallet > 255) {
    throw new Error("pallet_invalid");
  }
  if (args.dest.length !== 32) throw new Error("dest_invalid");
  return concat(
    [args.pallet, TRANSFER_KEEP_ALIVE_CALL, MULTIADDRESS_ID],
    args.dest,
    compactEncode(args.value),
  );
}

/**
 * Экстринсик с подписью-пустышкой, готовый для `payment_queryInfo`.
 *
 * `metadataHashMode` — лишний байт расширения `CheckMetadataHash`: у Polkadot и
 * Kusama оно есть, у Taler нет, а экстринсик с неверным набором расширений не
 * декодируется вообще. Поэтому вариант подбирается попыткой, а не хранится в
 * реестре: набор расширений меняется обновлением рантайма.
 */
export function fakeSignedExtrinsic(args: {
  call: Uint8Array;
  signer?: Uint8Array;
  signature?: Uint8Array;
  metadataHashMode: boolean;
}): string {
  const signer = args.signer ?? DUMMY_SIGNER;
  const signature = args.signature ?? DUMMY_SIGNATURE;
  if (signer.length !== 32) throw new Error("signer_invalid");
  if (signature.length !== 64) throw new Error("signature_invalid");
  const body = concat(
    [SIGNED_VERSION, MULTIADDRESS_ID],
    signer,
    [MULTISIGNATURE_SR25519],
    signature,
    [ERA_IMMORTAL],
    compactEncode(ZERO), // нонс
    compactEncode(ZERO), // чаевые
    args.metadataHashMode ? [0x00] : [],
    args.call,
  );
  return `0x${toHex(concat(compactEncode(BigInt(body.length)), body))}`;
}
