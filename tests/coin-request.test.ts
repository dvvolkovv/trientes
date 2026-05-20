import { describe, expect, it } from "vitest";
import { validateCoinRequest } from "@/lib/coin-request";

describe("validateCoinRequest", () => {
  it("accepts a fully valid request", () => {
    expect(
      validateCoinRequest({
        name: "Foobar Chain",
        symbol: "FOO",
        coingeckoId: "foobar",
        reason: "Excellent project to track.",
      }),
    ).toEqual({
      ok: true,
      data: {
        name: "Foobar Chain",
        symbol: "FOO",
        coingeckoId: "foobar",
        reason: "Excellent project to track.",
      },
    });
  });

  it("trims whitespace and uppercases symbol", () => {
    const r = validateCoinRequest({
      name: "  Sample  ",
      symbol: "  sam  ",
      coingeckoId: "  sample-id  ",
      reason: "  good reason  ",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.data.name).toBe("Sample");
      expect(r.data.symbol).toBe("SAM");
      expect(r.data.coingeckoId).toBe("sample-id");
      expect(r.data.reason).toBe("good reason");
    }
  });

  it("treats empty coingeckoId as null", () => {
    const r = validateCoinRequest({
      name: "X",
      symbol: "X",
      coingeckoId: "   ",
      reason: "ok ok",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.data.coingeckoId).toBeNull();
  });

  it("rejects missing name", () => {
    expect(validateCoinRequest({ name: "", symbol: "X", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "name_required",
    });
  });

  it("rejects missing symbol", () => {
    expect(validateCoinRequest({ name: "X", symbol: "  ", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "symbol_required",
    });
  });

  it("rejects symbol longer than 12 chars", () => {
    expect(validateCoinRequest({ name: "X", symbol: "TOOOOOOOLONG1", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "symbol_too_long",
    });
  });

  it("rejects reason shorter than 5 chars", () => {
    expect(validateCoinRequest({ name: "X", symbol: "X", reason: "hi" })).toEqual({
      ok: false,
      reason: "reason_too_short",
    });
  });

  it("rejects reason longer than 2000 chars", () => {
    expect(
      validateCoinRequest({
        name: "X",
        symbol: "X",
        reason: "a".repeat(2001),
      }),
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });

  it("rejects malformed coingeckoId", () => {
    expect(
      validateCoinRequest({ name: "X", symbol: "X", coingeckoId: "BAD ID!", reason: "ok ok ok" }),
    ).toEqual({ ok: false, reason: "coingecko_id_invalid" });
  });
});
