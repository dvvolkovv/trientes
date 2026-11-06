import { describe, expect, it } from "vitest";
import { coinPaymentTags, parseCoinSelector } from "@/lib/crypto-map";

describe("parseCoinSelector", () => {
  it("defaults to bitcoin when the param is missing or blank", () => {
    expect(parseCoinSelector(null)).toEqual({ kind: "coin", coinId: "bitcoin" });
    expect(parseCoinSelector("  ")).toEqual({ kind: "coin", coinId: "bitcoin" });
  });

  it("treats a plain value as a lowercased CoinGecko id", () => {
    expect(parseCoinSelector("Bitcoin-Cash")).toEqual({ kind: "coin", coinId: "bitcoin-cash" });
  });

  it("reads card:<cuid> as a self-listed card", () => {
    expect(parseCoinSelector("card:clz1abc234def567")).toEqual({
      kind: "card",
      cardId: "clz1abc234def567",
    });
  });

  it("never falls back to a coin when the prefix says card — a junk id matches nothing", () => {
    expect(parseCoinSelector("card:")).toEqual({ kind: "card", cardId: "" });
    expect(parseCoinSelector("card:../../etc/passwd")).toEqual({ kind: "card", cardId: "" });
    expect(parseCoinSelector("CARD:clz1abc234def567")).toEqual({
      kind: "card",
      cardId: "clz1abc234def567",
    });
  });
});

describe("coinPaymentTags", () => {
  it("still resolves known coins and falls back to the generic crypto tag", () => {
    expect(coinPaymentTags("bitcoin", "btc")).toContain("payment:bitcoin");
    expect(coinPaymentTags("taler", "tal")).toEqual(["payment:cryptocurrencies"]);
  });
});
