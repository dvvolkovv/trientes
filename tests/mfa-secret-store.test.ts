import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, mfaKeyFrom } from "@/lib/mfa/secret-store";
import {
  RECOVERY_CODE_COUNT,
  hashRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from "@/lib/mfa/recovery";

const KEY = mfaKeyFrom("0".repeat(64)); // 32 байта hex

describe("sealSecret / openSecret", () => {
  it("прочитанное обратно совпадает с ключом", () => {
    const secret = new Uint8Array([1, 2, 3, 250, 255]);
    expect([...openSecret(sealSecret(secret, KEY), KEY)]).toEqual([...secret]);
  });

  it("одно и то же запечатывается каждый раз по-разному: вектор свой", () => {
    const secret = new Uint8Array([1, 2, 3]);
    expect(sealSecret(secret, KEY)).not.toBe(sealSecret(secret, KEY));
  });

  it("подменённый байт — отказ, а не другой ключ", () => {
    const sealed = sealSecret(new Uint8Array([1, 2, 3]), KEY);
    const parts = sealed.split(":");
    const body = Buffer.from(parts[2]!, "base64url");
    body[0] = body[0]! ^ 0xff;
    parts[2] = body.toString("base64url");
    expect(() => openSecret(parts.join(":"), KEY)).toThrow();
  });

  it("чужим ключом не открывается: дамп таблицы входа не даёт", () => {
    const sealed = sealSecret(new Uint8Array([1, 2, 3]), KEY);
    expect(() => openSecret(sealed, mfaKeyFrom("1".repeat(64)))).toThrow();
  });

  it("негодный ключ приложения — исключение при чтении ключа, а не при первом входе", () => {
    expect(() => mfaKeyFrom("")).toThrow();
    expect(() => mfaKeyFrom("короткий")).toThrow();
    expect(() => mfaKeyFrom("0".repeat(62))).toThrow();
  });
});

describe("коды восстановления", () => {
  it("их десять, все разные, и по ним не угадать следующий", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
  });

  it("набранный код узнаётся в любом виде: регистр, пробелы, без дефисов", () => {
    const code = "a1b2-c3d4-e5f6";
    const target = hashRecoveryCode(code);
    for (const typed of ["A1B2-C3D4-E5F6", " a1b2 c3d4 e5f6 ", "a1b2c3d4e5f6"]) {
      expect(hashRecoveryCode(typed)).toBe(target);
    }
  });

  it("в базе лежит хеш, а не код", () => {
    const code = newRecoveryCodes()[0]!;
    const hash = hashRecoveryCode(code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(normalizeRecoveryCode(code));
  });

  it("разные коды дают разные хеши", () => {
    expect(hashRecoveryCode("a1b2-c3d4-e5f6")).not.toBe(hashRecoveryCode("a1b2-c3d4-e5f7"));
  });
});
