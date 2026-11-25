import { describe, expect, it } from "vitest";
import { aggregateSales, type ReportSale } from "@/lib/reports/aggregate";

function sale(over: Partial<ReportSale> = {}): ReportSale {
  return {
    id: over.id ?? "s1",
    number: over.number ?? 1,
    createdAt: over.createdAt ?? new Date("2026-11-25T12:00:00Z"),
    currency: over.currency ?? "EUR",
    listTotal: over.listTotal ?? 100,
    total: over.total ?? 90,
    cashbackTotal: over.cashbackTotal ?? 4.5,
    payment: over.payment ?? "CASH",
    status: over.status ?? "COMPLETED",
    cancelReason: over.cancelReason ?? null,
    pointId: over.pointId ?? "p1",
    pointName: over.pointName ?? "Shop",
    cashierId: over.cashierId ?? "u1",
    cashierName: over.cashierName ?? "anna",
    buyerClaimed: over.buyerClaimed ?? false,
    payCoin: over.payCoin ?? null,
    payRate: over.payRate ?? null,
    payCoinAmount: over.payCoinAmount ?? null,
    lines: over.lines ?? [
      { productId: "pr1", name: "Tea", unit: "pcs", qty: 2, listPrice: 50, price: 45, cashbackPercent: 5, cashbackAmount: 4.5 },
    ],
  };
}

describe("сводка продаж", () => {
  it("суммы разных валют не складываются", () => {
    const out = aggregateSales([sale({ currency: "EUR" }), sale({ id: "s2", currency: "CZK", total: 500, listTotal: 500, cashbackTotal: 0 })], "UTC");
    expect(out.currencies.map((c) => c.currency).sort()).toEqual(["CZK", "EUR"]);
    expect(out.currencies.find((c) => c.currency === "EUR")!.revenue).toBe(90);
    expect(out.currencies.find((c) => c.currency === "CZK")!.revenue).toBe(500);
    expect(out.receipts).toBe(2);
  });

  it("скидка выводится вычитанием витринной суммы и фактической", () => {
    const c = aggregateSales([sale()], "UTC").currencies[0];
    expect(c.listTotal).toBe(100);
    expect(c.revenue).toBe(90);
    expect(c.discount).toBe(10);
  });

  it("отменённый чек в выручку не идёт, но и не исчезает", () => {
    const out = aggregateSales(
      [sale(), sale({ id: "s2", number: 2, status: "CANCELLED", total: 40, listTotal: 40, cashbackTotal: 2 })],
      "UTC",
    );
    const c = out.currencies[0];
    expect(c.receipts).toBe(1);
    expect(c.revenue).toBe(90);
    // Кэшбэк отменённого чека тоже не объявлен: чек не состоялся.
    expect(c.cashback).toBe(4.5);
    expect([c.cancelledCount, c.cancelledTotal]).toEqual([1, 40]);
    expect(out.cancelled).toBe(1);
  });

  it("разбивки считают чеки и выручку, топ товаров — количество и выручку строк", () => {
    const out = aggregateSales(
      [
        sale(),
        sale({ id: "s2", number: 2, payment: "CARD", pointId: "p2", pointName: "Kiosk", cashierId: "u2", cashierName: "bob", total: 10, listTotal: 10, cashbackTotal: 0, lines: [{ productId: "pr1", name: "Tea", unit: "pcs", qty: 1, listPrice: 10, price: 10, cashbackPercent: null, cashbackAmount: 0 }] }),
      ],
      "UTC",
    );
    const c = out.currencies[0];
    expect(c.byPayment.map((b) => [b.key, b.receipts, b.revenue])).toEqual([
      ["CASH", 1, 90],
      ["CARD", 1, 10],
    ]);
    expect(c.byPoint.map((b) => b.label)).toEqual(["Shop", "Kiosk"]);
    expect(c.byCashier.map((b) => b.label)).toEqual(["anna", "bob"]);
    expect(c.topProducts).toEqual([{ key: "pr1", label: "Tea", qty: 3, revenue: 100, cashback: 4.5 }]);
  });

  it("день разбивки берётся в поясе отчёта", () => {
    const out = aggregateSales([sale({ createdAt: new Date("2026-11-24T23:30:00Z") })], "Europe/Prague");
    expect(out.currencies[0].byDay.map((d) => d.day)).toEqual(["2026-11-25"]);
  });

  it("строка без паспорта остаётся в верхушке под своим названием", () => {
    const out = aggregateSales(
      [sale({ lines: [{ productId: null, name: "Haircut", unit: "service", qty: 1, listPrice: 30, price: 30, cashbackPercent: null, cashbackAmount: 0 }] })],
      "UTC",
    );
    expect(out.currencies[0].topProducts[0]).toMatchObject({ key: "name:Haircut", label: "Haircut", revenue: 30 });
  });

  it("усечение выборки названо в сводке", () => {
    expect(aggregateSales([sale()], "UTC", { truncated: true }).truncated).toBe(true);
    expect(aggregateSales([sale()], "UTC").truncated).toBe(false);
  });
});
