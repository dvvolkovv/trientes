import { describe, it, expect } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as secp from "@noble/secp256k1";
import {
  addressFromPublicKey,
  personalMessageHash,
  recoverSigner,
  sameAddress,
} from "../src/lib/evm-signature";

// Подпись в тесте делаем сами — для этого noble нужны хеши.
secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (k: Uint8Array, m: Uint8Array) => hmac(sha256, k, m);

const PRIV = hexToBytes("4c0883a69102937d6231471b5dbb6204fe512961708279f2e3e8a5d4b8e3e3e3");
const OTHER = hexToBytes("5d862374c6a52ef9b9e84e0ba3b3cc9c12bb2b54b2fcb9b3cf84ea5f55b8a1c1");

/** Эталонный хеш: 0x19, текст префикса, длина в байтах, тело. */
function referenceHash(text: string): string {
  const body = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode(`Ethereum Signed Message:\n${body.length}`);
  const buf = new Uint8Array(1 + prefix.length + body.length);
  buf[0] = 0x19;
  buf.set(prefix, 1);
  buf.set(body, 1 + prefix.length);
  return bytesToHex(keccak_256(buf));
}

/** Подпись в формате Ethereum: r||s||v, v = 27/28. */
function sign(text: string, priv: Uint8Array, vOffset = 27): string {
  const sig = secp.sign(personalMessageHash(text), priv, { prehash: false, format: "recovered" });
  const recovery = sig[0];
  const rs = sig.subarray(1);
  return `0x${bytesToHex(rs)}${(recovery + vOffset).toString(16).padStart(2, "0")}`;
}

const addressOf = (priv: Uint8Array) => addressFromPublicKey(secp.getPublicKey(priv, false));

describe("personalMessageHash", () => {
  it("хеширует с префиксом EIP-191", () => {
    expect(bytesToHex(personalMessageHash("hello"))).toBe(referenceHash("hello"));
  });

  it("длина считается в байтах, а не в символах", () => {
    expect(bytesToHex(personalMessageHash("привет"))).toBe(referenceHash("привет"));
  });

  it("известный вектор: подпись geth для «hello»", () => {
    // keccak256 префиксованного «hello» — фиксированное значение, поэтому
    // ошибка в сборке буфера видна сразу, без сверки с кошельком.
    expect(bytesToHex(personalMessageHash("hello"))).toBe(
      "50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
    );
  });
});

describe("recoverSigner", () => {
  const TEXT = "Trientes card ownership claim\ncard: taler\nclaimant: dv\ntoken: trientes-abc";

  it("восстанавливает адрес подписавшего", () => {
    const r = recoverSigner(TEXT, sign(TEXT, PRIV));
    expect(r.error).toBeNull();
    expect(sameAddress(r.address, addressOf(PRIV))).toBe(true);
  });

  it("понимает v в виде 0/1", () => {
    const r = recoverSigner(TEXT, sign(TEXT, PRIV, 0));
    expect(sameAddress(r.address, addressOf(PRIV))).toBe(true);
  });

  it("подпись другого ключа даёт другой адрес", () => {
    const r = recoverSigner(TEXT, sign(TEXT, OTHER));
    expect(r.error).toBeNull();
    expect(sameAddress(r.address, addressOf(PRIV))).toBe(false);
  });

  it("подпись другого текста не восстанавливает тот же адрес", () => {
    const r = recoverSigner(TEXT, sign("другой текст", PRIV));
    expect(sameAddress(r.address, addressOf(PRIV))).toBe(false);
  });

  it("мусор вместо подписи", () => {
    for (const bad of ["", "0x", "0x1234", "нет", `0x${"z".repeat(130)}`]) {
      expect(recoverSigner(TEXT, bad)).toEqual({ address: null, error: "signature_invalid" });
    }
  });

  it("недопустимый байт восстановления", () => {
    const good = sign(TEXT, PRIV).slice(2, -2);
    expect(recoverSigner(TEXT, `0x${good}07`)).toEqual({ address: null, error: "signature_invalid" });
  });

  it("испорченные r/s не роняют проверку", () => {
    const bad = `0x${"1".repeat(128)}1b`;
    expect(recoverSigner(TEXT, bad).address).not.toBe(addressOf(PRIV));
  });
});

describe("sameAddress", () => {
  it("не зависит от регистра и пробелов", () => {
    expect(sameAddress("0xAbC", " 0xabc ")).toBe(true);
    expect(sameAddress(null, "0xabc")).toBe(false);
  });
});
