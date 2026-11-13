import { describe, expect, it } from "vitest";
import { circulatingCoins } from "@/lib/coin-card-circulating";

describe("circulatingCoins", () => {
  it("берёт проверенный сетью выпуск", () => {
    expect(
      circulatingCoins({
        tokenomics: { circulating: 500 },
        supply: { circulating: "346928172.74", checkError: null },
      }),
    ).toEqual({ coins: 346928172.74, verified: true });
  });

  it("при ошибке чтения падает на заявление проекта и помечает его", () => {
    expect(
      circulatingCoins({
        tokenomics: { circulating: 1000 },
        supply: { circulating: "999", checkError: "rpc_unreachable" },
      }),
    ).toEqual({ coins: 1000, verified: false });
  });

  it("долю одной сети за оборот монеты не выдаёт", () => {
    expect(
      circulatingCoins({
        tokenomics: {},
        supply: { circulating: "210696", checkError: "supply_share" },
      }),
    ).toBeNull();
  });

  it("без обоих чисел строки нет", () => {
    expect(circulatingCoins({ tokenomics: null, supply: null })).toBeNull();
  });
});
