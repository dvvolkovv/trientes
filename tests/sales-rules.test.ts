import { describe, expect, it } from "vitest";
import {
  cancelAllowed,
  canClaimReceipt,
  isService,
  parseQty,
  saleRightsFor,
  saleTotals,
  stockDeltas,
  validateSale,
  type OfferedProduct,
} from "@/lib/sales/rules";

/**
 * Касса (слайс CK). Проверяется то, что решает слайс: продажа списывает товар, скидка
 * выводится, услуга полки не требует, кэшбэк считается снимком ставки, а копию чека
 * привязывает только покупатель залистованного продавца.
 */

const tea: OfferedProduct = {
  productId: "p-tea",
  name: "Чай",
  unit: "pcs",
  currency: "EUR",
  listPrice: 100,
  cashbackPercent: 5,
};
const haircut: OfferedProduct = {
  productId: "p-cut",
  name: "Стрижка",
  unit: "service",
  currency: "EUR",
  listPrice: 300,
  cashbackPercent: null,
};
const euroJam: OfferedProduct = { ...tea, productId: "p-jam", name: "Варенье", currency: "USD" };

const base = { payment: "CASH", payCoin: null, payRate: null, payCoinAmount: null, hasShelf: true };
const ctx = { offers: [tea, haircut, euroJam], salesToday: 0 };

describe("чек кассы", () => {
  it("цена по витрине, кэшбэк по ставке, суммы сходятся", () => {
    const res = validateSale({ ...base, lines: [{ productId: "p-tea", qty: "2", price: "" }] }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.totals).toEqual({
      currency: "EUR",
      listTotal: 200,
      total: 200,
      discount: 0,
      cashbackTotal: 10,
    });
    expect(res.value.lines[0].cashbackPercent).toBe(5);
  });

  it("пониженная цена становится скидкой, а не вторым числом", () => {
    const res = validateSale({ ...base, lines: [{ productId: "p-tea", qty: "1", price: "90" }] }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.totals.discount).toBe(10);
    expect(res.value.totals.total).toBe(90);
    // Кэшбэк — с фактической суммы: обещание считается от того, что человек заплатил.
    expect(res.value.totals.cashbackTotal).toBe(4.5);
  });

  it("цену выше витринной не принимает", () => {
    const res = validateSale({ ...base, lines: [{ productId: "p-tea", qty: "1", price: "120" }] }, ctx);
    expect(res).toEqual({ ok: false, reason: "price_above_list" });
  });

  it("две валюты в одном чеке — отказ", () => {
    const res = validateSale(
      { ...base, lines: [{ productId: "p-tea", qty: "1", price: "" }, { productId: "p-jam", qty: "1", price: "" }] },
      ctx,
    );
    expect(res).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  it("товар без живого предложения не продаётся", () => {
    const res = validateSale({ ...base, lines: [{ productId: "p-ghost", qty: "1", price: "" }] }, ctx);
    expect(res).toEqual({ ok: false, reason: "offer_missing" });
  });

  it("один товар дважды — отказ, а не две строки", () => {
    const res = validateSale(
      { ...base, lines: [{ productId: "p-tea", qty: "1", price: "" }, { productId: "p-tea", qty: "2", price: "" }] },
      ctx,
    );
    expect(res).toEqual({ ok: false, reason: "duplicate_line" });
  });

  it("товар без полки не продаётся, услуга — продаётся", () => {
    const goods = validateSale(
      { ...base, hasShelf: false, lines: [{ productId: "p-tea", qty: "1", price: "" }] },
      ctx,
    );
    expect(goods).toEqual({ ok: false, reason: "shelf_required" });

    const service = validateSale(
      { ...base, hasShelf: false, lines: [{ productId: "p-cut", qty: "1", price: "" }] },
      ctx,
    );
    expect(service.ok).toBe(true);
    if (!service.ok) return;
    expect(stockDeltas(service.value.lines)).toEqual([]);
  });

  it("с полки уходят только товарные строки", () => {
    const res = validateSale(
      { ...base, lines: [{ productId: "p-tea", qty: "3", price: "" }, { productId: "p-cut", qty: "1", price: "" }] },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stockDeltas(res.value.lines)).toEqual([{ productId: "p-tea", qty: 3 }]);
  });

  it("крипта без имени монеты не принимается", () => {
    const res = validateSale(
      { ...base, payment: "CRYPTO", lines: [{ productId: "p-tea", qty: "1", price: "" }] },
      ctx,
    );
    expect(res).toEqual({ ok: false, reason: "coin_required" });
  });

  it("монета, курс и сумма в монете — числа продавца", () => {
    const res = validateSale(
      {
        ...base,
        payment: "CRYPTO",
        payCoin: "btc",
        payRate: "2500000",
        payCoinAmount: "0.00004",
        lines: [{ productId: "p-tea", qty: "1", price: "" }],
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.payCoin).toBe("BTC");
    expect(res.value.payRate).toBe(2500000);
    expect(res.value.payCoinAmount).toBe(0.00004);
  });

  it("пустой чек и суточный потолок отвергаются вслух", () => {
    expect(validateSale({ ...base, lines: [] }, ctx)).toEqual({ ok: false, reason: "lines_required" });
    expect(
      validateSale({ ...base, lines: [{ productId: "p-tea", qty: "1", price: "" }] }, { ...ctx, salesToday: 500 }),
    ).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("количество — число больше нуля с тремя знаками", () => {
    expect(parseQty("1,5")).toBe(1.5);
    expect(parseQty("0")).toBeNull();
    expect(parseQty("1.2345")).toBeNull();
    expect(parseQty("-2")).toBeNull();
  });

  it("услуга опознаётся по единице", () => {
    expect(isService("service")).toBe(true);
    expect(isService("hour")).toBe(true);
    expect(isService("pcs")).toBe(false);
  });

  it("суммы складываются по копейкам, а не по плавающей точке", () => {
    const line = {
      productId: "x",
      name: "x",
      unit: "pcs",
      qty: 3,
      listPrice: 0.1,
      price: 0.1,
      cashbackPercent: null,
      cashbackAmount: 0,
      stocked: true,
    };
    expect(saleTotals("EUR", [line, line]).total).toBe(0.6);
  });
});

describe("права кассы", () => {
  const perms = (level?: string) => ({ sales: level });

  it("нет права — ни кассы, ни списка", () => {
    expect(saleRightsFor({ suspendedAt: null, deletedAt: null, permissions: perms() })).toEqual({
      see: false,
      sell: false,
    });
  });

  it("VIEW читает, но не продаёт", () => {
    expect(saleRightsFor({ suspendedAt: null, deletedAt: null, permissions: perms("VIEW") })).toEqual({
      see: true,
      sell: false,
    });
  });

  it("снятое надзором предприятие не продаёт, но чеки читаются", () => {
    expect(
      saleRightsFor({ suspendedAt: new Date(), deletedAt: null, permissions: perms("EDIT") }),
    ).toEqual({ see: true, sell: false });
  });
});

describe("копия покупателю", () => {
  const now = new Date("2026-11-25T10:00:00Z");

  it("привязывается только у залистованного продавца", () => {
    expect(
      canClaimReceipt({ status: "APPROVED", suspendedAt: null, deletedAt: null, expiresAt: null, now }),
    ).toEqual({ ok: true });
    expect(
      canClaimReceipt({ status: "PENDING", suspendedAt: null, deletedAt: null, expiresAt: null, now }),
    ).toEqual({ ok: false, reason: "company_not_listed" });
    expect(
      canClaimReceipt({ status: "APPROVED", suspendedAt: now, deletedAt: null, expiresAt: null, now }),
    ).toEqual({ ok: false, reason: "company_not_listed" });
  });

  it("истёкшая ссылка не привязывается", () => {
    expect(
      canClaimReceipt({
        status: "APPROVED",
        suspendedAt: null,
        deletedAt: null,
        expiresAt: new Date("2026-11-24T10:00:00Z"),
        now,
      }),
    ).toEqual({ ok: false, reason: "link_expired" });
  });
});

describe("отмена чека", () => {
  it("требует причину словами и не повторяется", () => {
    expect(cancelAllowed({ status: "COMPLETED", reason: " " })).toEqual({ ok: false, reason: "reason_required" });
    expect(cancelAllowed({ status: "COMPLETED", reason: "ошибка кассира" })).toEqual({ ok: true });
    expect(cancelAllowed({ status: "CANCELLED", reason: "ошибка кассира" })).toEqual({
      ok: false,
      reason: "already_cancelled",
    });
  });
});
