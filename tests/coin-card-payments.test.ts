import { describe, expect, it } from "vitest";
import {
  MAX_FEE_NOTE,
  MAX_INTEGRATIONS,
  PAYMENT_INTEGRATION_KINDS,
  validatePayments,
} from "@/lib/coin-card-payments";

const ok = {
  finalitySeconds: 6,
  blockSeconds: 6,
  tps: 1000,
  feeUsdTypical: 0.004,
  feeNote: "2% от эталонной сетки Substrate",
  reversible: false,
  stablecoins: ["USDT"],
  integrations: [{ kind: "WOOCOMMERCE", name: "Taler for Woo", url: "https://taler.test/woo" }],
  refundPolicyUrl: null,
};

describe("validatePayments", () => {
  it("accepts a filled profile and keeps the numbers as numbers", () => {
    const r = validatePayments(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.finalitySeconds).toBe(6);
      expect(r.data.feeUsdTypical).toBe(0.004);
      expect(r.data.reversible).toBe(false);
    }
  });

  it("accepts an empty profile — a project may fill it later", () => {
    const r = validatePayments({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.finalitySeconds).toBe(null);
      expect(r.data.integrations).toEqual([]);
      expect(r.data.stablecoins).toEqual([]);
    }
  });

  it("refuses a negative or non-numeric finality — a merchant plans around it", () => {
    expect(validatePayments({ ...ok, finalitySeconds: -1 })).toEqual({ ok: false, reason: "finality_invalid" });
    expect(validatePayments({ ...ok, finalitySeconds: "fast" })).toEqual({ ok: false, reason: "finality_invalid" });
    expect(validatePayments({ ...ok, blockSeconds: 0 })).toEqual({ ok: false, reason: "finality_invalid" });
  });

  it("refuses a zero or negative throughput", () => {
    expect(validatePayments({ ...ok, tps: 0 })).toEqual({ ok: false, reason: "tps_invalid" });
    expect(validatePayments({ ...ok, tps: -5 })).toEqual({ ok: false, reason: "tps_invalid" });
  });

  it("refuses a negative fee but allows a free network", () => {
    expect(validatePayments({ ...ok, feeUsdTypical: -0.01 })).toEqual({ ok: false, reason: "fee_invalid" });
    const free = validatePayments({ ...ok, feeUsdTypical: 0 });
    expect(free.ok && free.data.feeUsdTypical).toBe(0);
  });

  it("refuses an integration without a name or with a broken url", () => {
    expect(validatePayments({ ...ok, integrations: [{ kind: "POS", name: "", url: "https://x.test" }] }))
      .toEqual({ ok: false, reason: "integration_incomplete" });
    expect(validatePayments({ ...ok, integrations: [{ kind: "POS", name: "Cash", url: "javascript:alert(1)" }] }))
      .toEqual({ ok: false, reason: "integration_url_invalid" });
  });

  it("falls back to OTHER for an unknown integration kind instead of dropping the row", () => {
    const r = validatePayments({ ...ok, integrations: [{ kind: "MAGIC", name: "X", url: null }] });
    expect(r.ok && r.data.integrations[0].kind).toBe("OTHER");
    expect(PAYMENT_INTEGRATION_KINDS).toContain("OTHER");
  });

  it("caps integrations and the fee note", () => {
    const many = Array.from({ length: MAX_INTEGRATIONS + 1 }, (_, i) => ({
      kind: "SDK", name: `sdk${i}`, url: null,
    }));
    expect(validatePayments({ ...ok, integrations: many })).toEqual({ ok: false, reason: "too_many_integrations" });
    expect(validatePayments({ ...ok, feeNote: "x".repeat(MAX_FEE_NOTE + 1) }))
      .toEqual({ ok: false, reason: "fee_note_too_long" });
  });

  it("uppercases stablecoin tickers and drops blanks", () => {
    const r = validatePayments({ ...ok, stablecoins: [" usdt ", "", "USDC"] });
    expect(r.ok && r.data.stablecoins).toEqual(["USDT", "USDC"]);
  });
});
