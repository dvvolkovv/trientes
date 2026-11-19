import { describe, expect, it } from "vitest";
import {
  MAX_WAREHOUSES,
  canArchiveWarehouse,
  cancelPlan,
  checkStock,
  movementPlan,
  receivePlan,
  transitTotals,
  validateMovement,
  validateWarehouse,
} from "@/lib/warehouse/rules";

const shelfOnPoint = {
  kind: "SHELF" as const,
  name: "Shop shelf",
  pointId: "p1",
  online: false,
  countryCode: null,
  address: null,
};

describe("validateWarehouse", () => {
  it("takes a shelf standing on an approved point of this company", () => {
    expect(validateWarehouse(shelfOnPoint, { count: 3, pointIds: ["p1", "p2"] })).toEqual({ ok: true });
  });

  it("takes an online shelf — the web store is a place too", () => {
    expect(
      validateWarehouse({ ...shelfOnPoint, pointId: null, online: true }, { count: 0, pointIds: [] }),
    ).toEqual({ ok: true });
  });

  it("refuses a shelf that stands nowhere: it would promise a place that does not exist", () => {
    expect(validateWarehouse({ ...shelfOnPoint, pointId: null, online: false }, { count: 0, pointIds: [] })).toEqual({
      ok: false,
      reason: "shelf_needs_place",
    });
  });

  it("refuses someone else's point", () => {
    expect(validateWarehouse(shelfOnPoint, { count: 0, pointIds: ["other"] })).toEqual({
      ok: false,
      reason: "point_unknown",
    });
  });

  it("refuses a point on a wholesale warehouse: a point is a sales place", () => {
    expect(
      validateWarehouse({ ...shelfOnPoint, kind: "WHOLESALE" }, { count: 0, pointIds: ["p1"] }),
    ).toEqual({ ok: false, reason: "point_not_allowed" });
  });

  it("needs a name and holds the ceiling", () => {
    expect(validateWarehouse({ ...shelfOnPoint, name: "  " }, { count: 0, pointIds: ["p1"] })).toEqual({
      ok: false,
      reason: "name_required",
    });
    expect(validateWarehouse(shelfOnPoint, { count: MAX_WAREHOUSES, pointIds: ["p1"] })).toEqual({
      ok: false,
      reason: "too_many",
    });
  });
});

describe("canArchiveWarehouse", () => {
  it("archives an empty warehouse and refuses one that still holds goods", () => {
    expect(canArchiveWarehouse(0)).toEqual({ ok: true });
    expect(canArchiveWarehouse(4)).toEqual({ ok: false, reason: "warehouse_not_empty" });
    // Отрицательный остаток — тоже не пустой склад: он требует разбора, а не архива.
    expect(canArchiveWarehouse(-1)).toEqual({ ok: false, reason: "warehouse_not_empty" });
  });
});

const receipt = { kind: "RECEIPT" as const, fromWarehouseId: null, toWarehouseId: "w1", qty: 10, note: null, carrierName: null };
const issue = { kind: "ISSUE" as const, fromWarehouseId: "w1", toWarehouseId: null, qty: 3, note: null, carrierName: null };
const transfer = { kind: "TRANSFER" as const, fromWarehouseId: "w1", toWarehouseId: "w2", qty: 5, note: null, carrierName: null };

describe("validateMovement", () => {
  it("takes the four kinds with their own warehouses", () => {
    expect(validateMovement(receipt)).toEqual({ ok: true });
    expect(validateMovement(issue)).toEqual({ ok: true });
    expect(validateMovement(transfer)).toEqual({ ok: true });
    expect(validateMovement({ ...receipt, kind: "ADJUST", qty: -2, note: "recount" })).toEqual({ ok: true });
  });

  it("demands the warehouse each kind needs", () => {
    expect(validateMovement({ ...receipt, toWarehouseId: null })).toEqual({ ok: false, reason: "to_required" });
    expect(validateMovement({ ...issue, fromWarehouseId: null })).toEqual({ ok: false, reason: "from_required" });
    expect(validateMovement({ ...transfer, toWarehouseId: null })).toEqual({ ok: false, reason: "to_required" });
  });

  it("refuses a transfer into the same warehouse", () => {
    expect(validateMovement({ ...transfer, toWarehouseId: "w1" })).toEqual({ ok: false, reason: "same_warehouse" });
  });

  it("refuses zero and takes a negative only on ADJUST, and only with a reason", () => {
    expect(validateMovement({ ...receipt, qty: 0 })).toEqual({ ok: false, reason: "qty_zero" });
    expect(validateMovement({ ...receipt, qty: -4 })).toEqual({ ok: false, reason: "qty_negative" });
    expect(validateMovement({ ...receipt, kind: "ADJUST", qty: -4, note: "ok" })).toEqual({
      ok: false,
      reason: "reason_required",
    });
  });
});

describe("movementPlan", () => {
  it("credits a receipt and debits an issue at once", () => {
    expect(movementPlan(receipt)).toEqual({ status: "DONE", deltas: [{ warehouseId: "w1", delta: 10 }] });
    expect(movementPlan(issue)).toEqual({ status: "DONE", deltas: [{ warehouseId: "w1", delta: -3 }] });
  });

  it("moves goods in one step when nobody carries them", () => {
    expect(movementPlan(transfer)).toEqual({
      status: "DONE",
      deltas: [
        { warehouseId: "w1", delta: -5 },
        { warehouseId: "w2", delta: 5 },
      ],
    });
  });

  it("with a carrier debits the source only: in transit is a third place, not the destination", () => {
    expect(movementPlan({ ...transfer, carrierName: "DHL" })).toEqual({
      status: "IN_TRANSIT",
      deltas: [{ warehouseId: "w1", delta: -5 }],
    });
  });

  it("applies an ADJUST to the warehouse named, in either direction", () => {
    expect(movementPlan({ ...receipt, kind: "ADJUST", qty: -2, note: "recount" })).toEqual({
      status: "DONE",
      deltas: [{ warehouseId: "w1", delta: -2 }],
    });
  });
});

describe("receivePlan", () => {
  const inTransit = { status: "IN_TRANSIT" as const, toWarehouseId: "w2", fromWarehouseId: "w1", qty: 5 };

  it("credits the destination once the goods arrive", () => {
    expect(receivePlan(inTransit)).toEqual({ ok: true, deltas: [{ warehouseId: "w2", delta: 5 }] });
  });

  it("refuses a second receipt: the same goods would arrive twice", () => {
    expect(receivePlan({ ...inTransit, status: "DONE" })).toEqual({ ok: false, reason: "not_in_transit" });
    expect(receivePlan({ ...inTransit, status: "CANCELLED" })).toEqual({ ok: false, reason: "not_in_transit" });
  });
});

describe("cancelPlan", () => {
  const inTransit = { status: "IN_TRANSIT" as const, toWarehouseId: "w2", fromWarehouseId: "w1", qty: 5 };

  it("returns the goods to the source — a counter-move, not a deletion", () => {
    expect(cancelPlan(inTransit)).toEqual({ ok: true, deltas: [{ warehouseId: "w1", delta: 5 }] });
  });

  it("refuses to cancel what already arrived", () => {
    expect(cancelPlan({ ...inTransit, status: "DONE" })).toEqual({ ok: false, reason: "not_cancellable" });
  });
});

describe("checkStock", () => {
  it("lets a debit through while the shelf holds enough", () => {
    expect(checkStock([{ warehouseId: "w1", delta: -3 }], { w1: 10 }, "ISSUE")).toEqual({ ok: true });
  });

  it("refuses to drive a balance below zero: negative stock is a typo, not a fact", () => {
    expect(checkStock([{ warehouseId: "w1", delta: -11 }], { w1: 10 }, "ISSUE")).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
    expect(checkStock([{ warehouseId: "w1", delta: -1 }], {}, "TRANSFER")).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("lets ADJUST go negative — a recount may discover a hole", () => {
    expect(checkStock([{ warehouseId: "w1", delta: -11 }], { w1: 10 }, "ADJUST")).toEqual({ ok: true });
  });
});

describe("transitTotals", () => {
  it("counts only what is on the road", () => {
    const rows = [
      { status: "IN_TRANSIT" as const, qty: 5, productId: "a" },
      { status: "IN_TRANSIT" as const, qty: 2, productId: "a" },
      { status: "DONE" as const, qty: 100, productId: "a" },
      { status: "CANCELLED" as const, qty: 7, productId: "a" },
      { status: "IN_TRANSIT" as const, qty: 1, productId: "b" },
    ];
    expect(transitTotals(rows)).toEqual({ a: 7, b: 1 });
  });
});
