/**
 * Проверка подписи EIP-191 (`personal_sign`). Нужна слайсу D: доказательство
 * владения карточкой — подпись текста вызова ключом адреса-владельца токена.
 *
 * Берём `@noble/secp256k1` и `@noble/hashes`, а не `ethers`/`viem`: нам нужны
 * ровно keccak и восстановление открытого ключа, а не половина SDK.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { recoverPublicKey } from "@noble/secp256k1";

export type SignatureError = "signature_invalid";

/** Байт 0x19 и текст префикса — ровно то, что кошелёк подставляет сам. */
const MAGIC = 0x19;
const PREFIX = "Ethereum Signed Message:\n";

/** Хеш, который кошелёк реально подписывает в `personal_sign`. */
export function personalMessageHash(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode(`${PREFIX}${body.length}`);
  const buf = new Uint8Array(1 + prefix.length + body.length);
  buf[0] = MAGIC;
  buf.set(prefix, 1);
  buf.set(body, 1 + prefix.length);
  return keccak_256(buf);
}

/** Адрес из несжатого открытого ключа (65 байт, первый — 0x04). */
export function addressFromPublicKey(pub: Uint8Array): string {
  const body = pub.length === 65 ? pub.subarray(1) : pub;
  return `0x${bytesToHex(keccak_256(body)).slice(-40)}`;
}

/**
 * Адрес, подписавший текст. Ethereum отдаёт подпись как `r||s||v` с `v` 27/28
 * (кошельки встречаются и с 0/1); noble ждёт `recovery||r||s`, поэтому байт
 * восстановления переставляется здесь.
 */
export function recoverSigner(
  text: string,
  signature: string,
): { address: string; error: null } | { address: null; error: SignatureError } {
  const hex = signature.trim().replace(/^0x/i, "").toLowerCase();
  if (hex.length !== 130 || !/^[0-9a-f]+$/.test(hex)) return { address: null, error: "signature_invalid" };

  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex);
  } catch {
    return { address: null, error: "signature_invalid" };
  }

  const raw = bytes[64];
  const recovery = raw >= 27 ? raw - 27 : raw;
  if (recovery !== 0 && recovery !== 1) return { address: null, error: "signature_invalid" };

  const noble = new Uint8Array(65);
  noble[0] = recovery;
  noble.set(bytes.subarray(0, 64), 1);

  try {
    // noble отдаёт байты открытого ключа; тип объявлен как Uint8Array.
    const pub: Uint8Array = recoverPublicKey(noble, personalMessageHash(text), {
      prehash: false,
      isCompressed: false,
    });
    return { address: addressFromPublicKey(pub), error: null };
  } catch {
    return { address: null, error: "signature_invalid" };
  }
}

/** Сравнение адресов без учёта регистра: EIP-55 нам здесь не нужен. */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
