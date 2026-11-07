import { describe, expect, it } from "vitest";
import {
  TRANSFER_KEEP_ALIVE_CALL,
  compactEncode,
  fakeSignedExtrinsic,
  transferKeepAliveCall,
} from "../src/lib/substrate-extrinsic";
import { toHex } from "../src/lib/substrate-codec";

const hex = (b: Uint8Array) => `0x${toHex(b)}`;
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe("compactEncode", () => {
  // SCALE: однобайтовый режим до 63, двухбайтовый до 2^14−1, четырёхбайтовый до
  // 2^30−1, дальше big-integer с байтом длины. Границы — там, где ошибаются.
  it.each([
    [0n, "0x00"],
    [1n, "0x04"],
    [63n, "0xfc"],
    [64n, "0x0101"],
    [16383n, "0xfdff"],
    [16384n, "0x02000100"],
    [1073741823n, "0xfeffffff"],
    [1073741824n, "0x0300000040"],
    [1000000000000n, "0x070010a5d4e8"],
  ])("кодирует %s", (value, expected) => {
    expect(hex(compactEncode(value as bigint))).toBe(expected);
  });

  it("отвергает отрицательное", () => {
    expect(() => compactEncode(-1n)).toThrow();
  });
});

describe("transferKeepAliveCall", () => {
  it("индекс вызова keep-alive равен 3 во всех версиях палеты балансов", () => {
    expect(TRANSFER_KEEP_ALIVE_CALL).toBe(3);
  });

  it("собирает вызов палеты балансов Taler байт в байт", () => {
    const call = transferKeepAliveCall({
      pallet: 6,
      dest: bytes(32, 0x11),
      value: 1000000000000n,
    });
    // 2 байта (палета, вызов) + 1 байт MultiAddress::Id + 32 байта ключа +
    // 6 байт компактной суммы.
    expect(call.length).toBe(41);
    expect(hex(call)).toBe(
      "0x0603001111111111111111111111111111111111111111111111111111111111111111070010a5d4e8",
    );
  });

  it("отвергает ключ не на 32 байта", () => {
    expect(() => transferKeepAliveCall({ pallet: 6, dest: bytes(31, 1), value: 1n })).toThrow();
  });
});

describe("fakeSignedExtrinsic", () => {
  const call = transferKeepAliveCall({ pallet: 6, dest: bytes(32, 0x11), value: 1000000000000n });
  const signer = bytes(32, 0x22);
  const signature = bytes(64, 0x33);

  // Голдены сняты с живого прогона 7 ноября 2026: ровно эти байты узел Taler
  // принял и посчитал комиссию 2 633 280 планка.
  it("без байта режима метаданных даёт тело 143 байта", () => {
    const ext = fakeSignedExtrinsic({ call, signer, signature, metadataHashMode: false });
    expect(ext.startsWith("0x3d02840022222222")).toBe(true);
    expect((ext.length - 2) / 2).toBe(145); // 2 байта компактной длины + 143
    expect(ext.endsWith("070010a5d4e8")).toBe(true);
  });

  it("с байтом режима метаданных тело на один байт длиннее", () => {
    const ext = fakeSignedExtrinsic({ call, signer, signature, metadataHashMode: true });
    expect(ext.startsWith("0x4102840022222222")).toBe(true);
    expect((ext.length - 2) / 2).toBe(146);
  });

  it("подпись-пустышка по умолчанию не нулевая и фиксированной длины", () => {
    const ext = fakeSignedExtrinsic({ call, metadataHashMode: false });
    expect((ext.length - 2) / 2).toBe(145);
  });
});
