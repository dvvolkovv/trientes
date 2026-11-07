import { describe, expect, it } from "vitest";
import {
  decodeAccountBalance,
  decodeUintLE,
  isSs58Address,
  ss58Decode,
  storageKey,
  systemAccountKey,
  timestampNowKey,
  toHex,
  totalIssuanceKey,
  twox128,
  xxh64,
} from "../src/lib/substrate-codec";

describe("twox128", () => {
  it("совпадает с опубликованными префиксами паллет", () => {
    expect(twox128("Balances")).toBe("c2261276cc9d1f8598ea4b6a74b15c2f");
    expect(twox128("TotalIssuance")).toBe("57c875e4cff74148e4628f264b974c80");
    expect(twox128("System")).toBe("26aa394eea5630e07c48ae0c9558cef7");
    expect(twox128("Account")).toBe("b99d880ec681799c0cf30e8886371da9");
  });

  it("xxh64 покрывает обе ветки алгоритма: короткий и длинный вход", () => {
    expect(xxh64(new Uint8Array(0), BigInt(0))).toBe(BigInt("0xef46db3751d8e999"));
    const long = new TextEncoder().encode("a".repeat(40));
    const short = new TextEncoder().encode("a".repeat(31));
    expect(xxh64(long, BigInt(0))).toBe(xxh64(long, BigInt(0)));
    expect(xxh64(long, BigInt(0))).not.toBe(xxh64(short, BigInt(0)));
    // Семя меняет результат — иначе twox128 склеивал бы две одинаковые половины.
    expect(xxh64(long, BigInt(0))).not.toBe(xxh64(long, BigInt(1)));
  });
});

describe("ключи хранилища", () => {
  it("storageKey склеивает два twox128", () => {
    expect(storageKey("Balances", "TotalIssuance")).toBe(
      "0xc2261276cc9d1f8598ea4b6a74b15c2f57c875e4cff74148e4628f264b974c80",
    );
    expect(totalIssuanceKey()).toBe(storageKey("Balances", "TotalIssuance"));
    expect(timestampNowKey()).toBe(storageKey("Timestamp", "Now"));
  });

  it("systemAccountKey = префикс + blake2_128 + сам ключ", () => {
    const pub = new Uint8Array(32).fill(7);
    const key = systemAccountKey(pub);
    expect(
      key.startsWith("0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9"),
    ).toBe(true);
    // 2 (0x) + 64 (префикс) + 32 (blake2_128) + 64 (сам ключ)
    expect(key.length).toBe(2 + 64 + 32 + 64);
    expect(key.endsWith("07".repeat(32))).toBe(true);
  });
});

describe("decodeUintLE", () => {
  it("читает little-endian", () => {
    expect(decodeUintLE("0x0100000000000000")).toBe(BigInt(1));
    expect(decodeUintLE("0x2b76f9092fcf23c34d00000000000000")).toBe(
      BigInt("1434460603938154051115"),
    );
  });

  it("пустое значение и мусор — null", () => {
    expect(decodeUintLE(null)).toBeNull();
    expect(decodeUintLE("0x")).toBeNull();
    expect(decodeUintLE("нет")).toBeNull();
    expect(decodeUintLE("0x123")).toBeNull();
  });
});

describe("decodeAccountBalance", () => {
  it("складывает free и reserved из AccountInfo", () => {
    // nonce(4) consumers(4) providers(4) sufficients(4) free(16) reserved(16) frozen(16) flags(16)
    const b = new Uint8Array(80);
    b[16] = 5; // free = 5
    b[32] = 9; // reserved = 9
    b[48] = 3; // frozen = 3 — подмножество free, в сумму не входит
    const hex = `0x${Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")}`;
    expect(decodeAccountBalance(hex)).toBe(BigInt(14));
  });

  it("пустой счёт — ноль, короткий ответ — null", () => {
    expect(decodeAccountBalance(null)).toBe(BigInt(0));
    expect(decodeAccountBalance("0x00")).toBeNull();
  });
});

describe("ss58Decode", () => {
  // Публичный ключ Alice из набора разработчика; адрес в формате Polkadot (0).
  const ALICE_POLKADOT = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
  const ALICE_PUB = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";

  it("разбирает адрес и отдаёт префикс с публичным ключом", () => {
    const r = ss58Decode(ALICE_POLKADOT);
    expect(r).not.toBeNull();
    expect(r!.prefix).toBe(0);
    expect(toHex(r!.pubkey)).toBe(ALICE_PUB);
  });

  it("битая контрольная сумма отбрасывается", () => {
    const broken = `${ALICE_POLKADOT.slice(0, -1)}${ALICE_POLKADOT.endsWith("5") ? "6" : "5"}`;
    expect(ss58Decode(broken)).toBeNull();
  });

  it("не base58 и пустая строка — null", () => {
    expect(ss58Decode("0xdeadbeef")).toBeNull();
    expect(ss58Decode("")).toBeNull();
    expect(ss58Decode(null)).toBeNull();
  });

  it("isSs58Address проверяет префикс сети", () => {
    expect(isSs58Address(ALICE_POLKADOT, 0)).toBe(true);
    expect(isSs58Address(ALICE_POLKADOT, 10960)).toBe(false);
    expect(isSs58Address(ALICE_POLKADOT)).toBe(true);
  });
});
