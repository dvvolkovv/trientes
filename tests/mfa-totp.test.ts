import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  newTotpSecret,
  otpauthUri,
  stepFor,
  totpCode,
  verifyTotp,
} from "@/lib/mfa/totp";

/**
 * Эталонные векторы RFC 6238 (приложение B), SHA-1, ключ «12345678901234567890».
 * Свою реализацию кода входа проверять собственными ожиданиями нельзя: сойдётся
 * сама с собой и разойдётся с приложением в телефоне.
 */
const RFC_SECRET = "12345678901234567890";
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("ключ RFC 6238 пишется буквами как в RFC 4648, без набивки", () => {
    expect(base32Encode(new TextEncoder().encode(RFC_SECRET))).toBe(RFC_SECRET_B32);
  });

  it("прочитанное обратно совпадает с исходным", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 7, 99]);
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
  });

  it("читается с пробелами и в нижнем регистре: человек вводит ключ руками", () => {
    expect([...base32Decode("gezd gnbv gy3t qojq gezdgnbvgy3tqojq")]).toEqual([
      ...new TextEncoder().encode(RFC_SECRET),
    ]);
  });

  it("буква не из алфавита — отказ, а не тихий пропуск", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow();
  });
});

describe("totpCode", () => {
  const secret = new TextEncoder().encode(RFC_SECRET);

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("секунда %i даёт код %s (RFC 6238)", (seconds, code) => {
    expect(totpCode(secret, stepFor(seconds * 1000))).toBe(code);
  });

  it("шаг — тридцать секунд", () => {
    expect(stepFor(0)).toBe(0);
    expect(stepFor(29_999)).toBe(0);
    expect(stepFor(30_000)).toBe(1);
  });
});

describe("verifyTotp", () => {
  const secret = new TextEncoder().encode(RFC_SECRET);
  const at = (step: number) => step * 30_000;

  it("свой код принят, и назван шаг — его запоминают от повтора", () => {
    const step = stepFor(at(100));
    const r = verifyTotp({ secret, code: totpCode(secret, step), nowMs: at(100) });
    expect(r).toEqual({ ok: true, step });
  });

  it("часы телефона на шаг назад или вперёд — код принят", () => {
    for (const drift of [-1, 1]) {
      const step = stepFor(at(100)) + drift;
      expect(verifyTotp({ secret, code: totpCode(secret, step), nowMs: at(100) })).toEqual({
        ok: true,
        step,
      });
    }
  });

  it("на два шага — отказ: шире окно только для подсматривающего", () => {
    const step = stepFor(at(100)) + 2;
    expect(verifyTotp({ secret, code: totpCode(secret, step), nowMs: at(100) })).toEqual({
      ok: false,
      reason: "code_invalid",
    });
  });

  it("тот же код второй раз — отказ: подсмотренный через плечо годился бы полторы минуты", () => {
    const step = stepFor(at(100));
    const code = totpCode(secret, step);
    expect(verifyTotp({ secret, code, nowMs: at(100), lastStep: step })).toEqual({
      ok: false,
      reason: "code_reused",
    });
  });

  it("код прежнего шага после принятого — тоже отказ", () => {
    const step = stepFor(at(100));
    const code = totpCode(secret, step - 1);
    expect(verifyTotp({ secret, code, nowMs: at(100), lastStep: step })).toEqual({
      ok: false,
      reason: "code_reused",
    });
  });

  it("мусор вместо кода — отказ без исключения", () => {
    for (const code of ["", "12345", "1234567", "abcdef", "12 34 56"]) {
      expect(verifyTotp({ secret, code, nowMs: at(100) })).toEqual({
        ok: false,
        reason: "code_invalid",
      });
    }
  });

  it("пробелы внутри шестизначного кода не мешают: приложения показывают «123 456»", () => {
    const step = stepFor(at(100));
    const code = totpCode(secret, step);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp({ secret, code: spaced, nowMs: at(100) })).toEqual({ ok: true, step });
  });
});

describe("newTotpSecret", () => {
  it("ключ двадцати байт, как в RFC 6238, и каждый раз свой", () => {
    const a = newTotpSecret();
    const b = newTotpSecret();
    expect(a).toHaveLength(20);
    expect(base32Encode(a)).not.toBe(base32Encode(b));
  });
});

describe("otpauthUri", () => {
  it("ссылка приложения: издатель, имя записи и ключ буквами", () => {
    const uri = otpauthUri({ issuer: "Trientes", account: "poolwatt", secretB32: RFC_SECRET_B32 });
    expect(uri).toBe(
      `otpauth://totp/Trientes:poolwatt?secret=${RFC_SECRET_B32}&issuer=Trientes&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("имя записи с пробелом и двоеточием не ломает ссылку", () => {
    const uri = otpauthUri({ issuer: "Trientes", account: "a b:c", secretB32: RFC_SECRET_B32 });
    expect(uri.startsWith("otpauth://totp/Trientes:a%20b%3Ac?")).toBe(true);
  });
});
