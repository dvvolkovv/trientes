import { describe, expect, it } from "vitest";
import {
  CASHBACK_MAX,
  OFFER_CURRENCIES,
  availabilityOf,
  offerVisible,
  parseAmount,
  validateOffer,
} from "@/lib/products/offers-rules";

describe("parseAmount", () => {
  it("takes a dot and a comma alike — the keypad gives what the phone gives", () => {
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount(" 7 ")).toBe(7);
  });

  it("refuses nonsense, zero and more than two decimals", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("1.005")).toBeNull();
  });
});

const offer = {
  price: "19.90",
  currency: "EUR",
  unit: "pcs",
  cashbackPercent: "5",
  onlineUrl: "https://shop.example.org/item",
  saleRules: null,
};

describe("validateOffer", () => {
  it("takes a filled offer and normalises its numbers", () => {
    expect(validateOffer(offer)).toEqual({
      ok: true,
      value: {
        price: 19.9,
        currency: "EUR",
        unit: "pcs",
        cashbackPercent: 5,
        onlineUrl: "https://shop.example.org/item",
        saleRules: null,
      },
    });
  });

  it("keeps the currency inside the list the site already shows", () => {
    expect(OFFER_CURRENCIES).toContain("USD");
    // Монет в списке цен нет: цену продажи задаёт фиат, монету выбирает покупатель.
    expect(OFFER_CURRENCIES).not.toContain("BTC");
    expect(validateOffer({ ...offer, currency: "XYZ" })).toEqual({ ok: false, reason: "currency_invalid" });
    expect(validateOffer({ ...offer, currency: "BTC" })).toEqual({ ok: false, reason: "currency_invalid" });
  });

  it("keeps the unit inside the white list", () => {
    expect(validateOffer({ ...offer, unit: "kg" }).ok).toBe(true);
    expect(validateOffer({ ...offer, unit: "barrels" })).toEqual({ ok: false, reason: "unit_invalid" });
  });

  it("refuses a price that is not a price", () => {
    expect(validateOffer({ ...offer, price: "0" })).toEqual({ ok: false, reason: "price_invalid" });
  });

  it("treats a cashback above the ceiling as a typo, and says so", () => {
    expect(validateOffer({ ...offer, cashbackPercent: "500" })).toEqual({ ok: false, reason: "cashback_invalid" });
    expect(validateOffer({ ...offer, cashbackPercent: String(CASHBACK_MAX) }).ok).toBe(true);
    expect(validateOffer({ ...offer, cashbackPercent: "0" })).toEqual({ ok: false, reason: "cashback_invalid" });
  });

  it("lets the cashback be absent — not every seller offers one", () => {
    const res = validateOffer({ ...offer, cashbackPercent: "" });
    expect(res.ok && res.value.cashbackPercent).toBeNull();
  });

  it("takes only http(s) links", () => {
    expect(validateOffer({ ...offer, onlineUrl: "javascript:alert(1)" })).toEqual({ ok: false, reason: "url_invalid" });
    const res = validateOffer({ ...offer, onlineUrl: "" });
    expect(res.ok && res.value.onlineUrl).toBeNull();
  });
});

const liveCompany = { status: "APPROVED" as const, suspendedAt: null, deletedAt: null };
const liveProduct = { suspendedAt: null, deletedAt: null, mergedIntoId: null };

describe("offerVisible", () => {
  it("shows an active offer of a listed company on a live passport", () => {
    expect(offerVisible({ status: "ACTIVE" }, liveCompany, liveProduct)).toBe(true);
  });

  it("hides a paused offer: out of stock is the seller's own word", () => {
    expect(offerVisible({ status: "PAUSED" }, liveCompany, liveProduct)).toBe(false);
  });

  it("hides offers of a company under supervision or not yet listed", () => {
    expect(offerVisible({ status: "ACTIVE" }, { ...liveCompany, suspendedAt: new Date() }, liveProduct)).toBe(false);
    expect(offerVisible({ status: "ACTIVE" }, { ...liveCompany, status: "PENDING" }, liveProduct)).toBe(false);
    expect(offerVisible({ status: "ACTIVE" }, { ...liveCompany, deletedAt: new Date() }, liveProduct)).toBe(false);
  });

  it("hides offers on a suspended or merged passport", () => {
    expect(offerVisible({ status: "ACTIVE" }, liveCompany, { ...liveProduct, suspendedAt: new Date() })).toBe(false);
    expect(offerVisible({ status: "ACTIVE" }, liveCompany, { ...liveProduct, mergedIntoId: "x" })).toBe(false);
  });
});

describe("availabilityOf", () => {
  it("says yes while any shelf holds something", () => {
    expect(availabilityOf([{ qty: 0 }, { qty: 2 }])).toBe(true);
    expect(availabilityOf([{ qty: 0 }])).toBe(false);
    expect(availabilityOf([])).toBe(false);
    // Отрицательный остаток «в наличии» не значит: это разбор, а не товар на полке.
    expect(availabilityOf([{ qty: -3 }])).toBe(false);
  });
});
