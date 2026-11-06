import { describe, it, expect } from "vitest";
import {
  DecodeError,
  EIP1967_IMPL_SLOT,
  SELECTORS,
  decodeString,
  decodeUint,
  decodeUint8,
  hasSelector,
  implementationFromSlot,
  isEmptyBytecode,
  isEvmAddress,
  normalizeAddress,
} from "../src/lib/evm-abi";

/** Динамическая строка: смещение, длина, данные с дополнением до слова. */
function encodeDynamicString(s: string): string {
  const bytes = Array.from(new TextEncoder().encode(s));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0");
  const offset = (32).toString(16).padStart(64, "0");
  const len = bytes.length.toString(16).padStart(64, "0");
  return "0x" + offset + len + padded;
}

describe("decodeString", () => {
  it("читает динамическую строку", () => {
    expect(decodeString(encodeDynamicString("USD Coin"))).toBe("USD Coin");
  });

  it("читает строку длиннее одного слова", () => {
    const long = "Very Long Token Name That Does Not Fit In One Word";
    expect(decodeString(encodeDynamicString(long))).toBe(long);
  });

  it("читает bytes32 старых токенов", () => {
    // MKR отдаёт symbol как bytes32: "MKR" + нули справа.
    const hex = "0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0");
    expect(decodeString(hex)).toBe("MKR");
  });

  it("читает юникод", () => {
    expect(decodeString(encodeDynamicString("Рубль"))).toBe("Рубль");
  });

  it("отвергает мусор", () => {
    expect(() => decodeString("0x")).toThrow(DecodeError);
    expect(() => decodeString("нет")).toThrow(DecodeError);
    expect(() => decodeString("0xzz")).toThrow(DecodeError);
  });

  it("отвергает обрезанные данные", () => {
    const full = encodeDynamicString("USD Coin");
    expect(() => decodeString(full.slice(0, full.length - 60))).toThrow(DecodeError);
  });
});

describe("decodeUint", () => {
  it("читает максимальный uint256 без потери точности", () => {
    const max = "0x" + "f".repeat(64);
    expect(decodeUint(max)).toBe((2n ** 256n - 1n).toString());
  });

  it("читает ноль", () => {
    expect(decodeUint("0x" + "0".repeat(64))).toBe("0");
  });

  it("отвергает слово не того размера", () => {
    expect(() => decodeUint("0x01")).toThrow(DecodeError);
  });
});

describe("decodeUint8", () => {
  it("читает decimals", () => {
    expect(decodeUint8("0x" + (18).toString(16).padStart(64, "0"))).toBe(18);
  });

  it("отвергает значение больше 255", () => {
    expect(() => decodeUint8("0x" + (256).toString(16).padStart(64, "0"))).toThrow(DecodeError);
  });
});

describe("hasSelector", () => {
  const code = "0x6080604052" + SELECTORS.mint.slice(2) + "deadbeef";

  it("находит селектор в байткоде", () => {
    expect(hasSelector(code, SELECTORS.mint)).toBe(true);
  });

  it("не находит отсутствующий селектор", () => {
    expect(hasSelector(code, SELECTORS.blacklist)).toBe(false);
  });

  it("на пустом коде всегда false", () => {
    expect(hasSelector("0x", SELECTORS.mint)).toBe(false);
  });
});

describe("isEmptyBytecode", () => {
  it("пустой код у кошелька", () => {
    expect(isEmptyBytecode("0x")).toBe(true);
    expect(isEmptyBytecode("0x00")).toBe(true);
    expect(isEmptyBytecode(null)).toBe(true);
  });

  it("непустой код у контракта", () => {
    expect(isEmptyBytecode("0x6080")).toBe(false);
  });
});

describe("implementationFromSlot", () => {
  it("нулевой слот — это не прокси", () => {
    expect(implementationFromSlot("0x" + "0".repeat(64))).toBeNull();
  });

  it("адрес в слоте — прокси", () => {
    const addr = "1111111111111111111111111111111111111111";
    expect(implementationFromSlot("0x" + "0".repeat(24) + addr)).toBe("0x" + addr);
  });

  it("мусор не ломает разбор", () => {
    expect(implementationFromSlot("нет")).toBeNull();
    expect(implementationFromSlot(null)).toBeNull();
  });
});

describe("адреса", () => {
  it("принимает валидный адрес и отвергает всё остальное", () => {
    expect(isEvmAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isEvmAddress("0x" + "a".repeat(39))).toBe(false);
    expect(isEvmAddress("5CfukGyB...")).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
  });

  it("нормализует регистр", () => {
    expect(normalizeAddress(" 0xAbCd" + "0".repeat(36) + " ")).toBe("0xabcd" + "0".repeat(36));
  });

  it("слот EIP-1967 — это 32 байта", () => {
    expect(EIP1967_IMPL_SLOT).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
