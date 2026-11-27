import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, codeUsable, newPairingCode, titleHasCode } from "@/lib/pay-link/code";

describe("код в названии ссылки", () => {
  it("длина и алфавит", () => {
    const code = newPairingCode();
    expect(code).toHaveLength(CODE_LENGTH);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });

  it("алфавит без похожих знаков — его диктуют глазами", () => {
    for (const ch of "01IO") expect(CODE_ALPHABET).not.toContain(ch);
  });

  it("байты раскладываются по алфавиту без перекоса", () => {
    // 32 знака = пять бит: длина алфавита делит 256 нацело, значит остаток не врёт.
    expect(256 % CODE_ALPHABET.length).toBe(0);
    expect(newPairingCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("ABCDEFGH");
  });

  it("находится в названии", () => {
    expect(titleHasCode("Оплата товара ABCD2345", "ABCD2345")).toBe(true);
  });

  it("без учёта регистра: код из заглавных, владелец набирает строчными", () => {
    expect(titleHasCode("оплата abcd2345", "ABCD2345")).toBe(true);
  });

  it("находится сквозь знаки нулевой ширины", () => {
    expect(titleHasCode("ABCD\u200b2345", "ABCD2345")).toBe(true);
  });

  it("ищется в полном названии до 200 знаков, а не в обрезанном до 80", () => {
    expect(titleHasCode(`${"товар ".repeat(15)}ABCD2345`, "ABCD2345")).toBe(true);
  });

  it("за 200 знаками не ищется: столько отдаёт служба", () => {
    expect(titleHasCode(`${"x".repeat(200)}ABCD2345`, "ABCD2345")).toBe(false);
  });

  it("чужого кода в названии нет", () => {
    expect(titleHasCode("Оплата товара ABCD2345", "WXYZ6789")).toBe(false);
    expect(titleHasCode("", "ABCD2345")).toBe(false);
    expect(titleHasCode(null, "ABCD2345")).toBe(false);
  });
});

describe("годность кода", () => {
  const now = new Date("2026-11-27T10:00:00Z");

  it("живой код годен", () => {
    expect(codeUsable({ expiresAt: new Date("2026-11-27T10:10:00Z"), usedAt: null }, now)).toBe(true);
  });

  it("истёкший — нет", () => {
    expect(codeUsable({ expiresAt: new Date("2026-11-27T09:59:00Z"), usedAt: null }, now)).toBe(false);
  });

  it("использованный второй раз не работает", () => {
    expect(codeUsable({ expiresAt: new Date("2026-11-27T10:10:00Z"), usedAt: now }, now)).toBe(false);
  });

  it("нет строки — нет кода", () => {
    expect(codeUsable(null, now)).toBe(false);
  });
});
