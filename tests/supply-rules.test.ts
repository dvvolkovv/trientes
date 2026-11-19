import { describe, expect, it } from "vitest";
import {
  MAX_ORDER_LINES,
  canEditLines,
  canReceive,
  canTransition,
  isFullyReceived,
  isOrderClosed,
  orderTotal,
  parsePrice,
  parseQty,
  remainingQty,
  supplyRights,
  validateOrderLine,
  validateReorderRule,
  validateSupplier,
} from "@/lib/supply/rules";
import { reorderPlan, type ReorderCandidate } from "@/lib/supply/reorder";
import { effectiveOption } from "@/lib/supply/select";

/**
 * Границы слайса BI. Главное, что здесь держится: сторону в сделке путать нельзя
 * (покупатель не подтверждает себе срок, поставщик не пишет в наш остаток), а прогон
 * автозаказа не плодит одинаковые черновики.
 */

describe("переходы заказа", () => {
  it("отправляет только покупатель и только черновик", () => {
    expect(canTransition({ status: "DRAFT", move: "SEND", side: "BUYER", hasPortal: true })).toBe(true);
    expect(canTransition({ status: "DRAFT", move: "SEND", side: "SUPPLIER", hasPortal: true })).toBe(false);
    expect(canTransition({ status: "SENT", move: "SEND", side: "BUYER", hasPortal: true })).toBe(false);
  });

  it("срок подтверждает поставщик, а не покупатель", () => {
    expect(canTransition({ status: "SENT", move: "CONFIRM", side: "SUPPLIER", hasPortal: true })).toBe(true);
    expect(canTransition({ status: "SENT", move: "CONFIRM", side: "BUYER", hasPortal: true })).toBe(false);
  });

  // Поставщика вне платформы на экране нет вовсе: некому нажать «подтверждаю» и
  // «отгружено». Без этого правила заказ внешнему поставщику замирал бы на
  // «отправлено», а товар с него не попадал бы на полку никогда (живой прогон BI).
  it("у поставщика без портала оба конца держит покупатель", () => {
    expect(canTransition({ status: "SENT", move: "CONFIRM", side: "BUYER", hasPortal: false })).toBe(true);
    expect(canTransition({ status: "CONFIRMED", move: "SHIP", side: "BUYER", hasPortal: false })).toBe(true);
    // А отказ остаётся ходом портала: отказ внешнего поставщика покупатель
    // записывает отменой с причиной — двух путей к одному факту не заводим.
    expect(canTransition({ status: "SENT", move: "DECLINE", side: "BUYER", hasPortal: false })).toBe(false);
    expect(canTransition({ status: "SENT", move: "DECLINE", side: "SUPPLIER", hasPortal: true })).toBe(true);
  });

  it("закрывает заказ покупатель: «остального не будет» знает только он", () => {
    expect(canTransition({ status: "SHIPPED", move: "CLOSE", side: "BUYER", hasPortal: true })).toBe(true);
    expect(canTransition({ status: "SHIPPED", move: "CLOSE", side: "SUPPLIER", hasPortal: true })).toBe(false);
  });

  it("отправленное покупатель уже не отменяет — оно едет", () => {
    expect(canTransition({ status: "CONFIRMED", move: "CANCEL", side: "BUYER", hasPortal: true })).toBe(true);
    expect(canTransition({ status: "SHIPPED", move: "CANCEL", side: "BUYER", hasPortal: true })).toBe(false);
  });

  it("у закрытого заказа переходов нет вовсе", () => {
    for (const status of ["RECEIVED", "DECLINED", "CANCELLED"] as const) {
      expect(isOrderClosed(status)).toBe(true);
      for (const side of ["BUYER", "SUPPLIER"] as const) {
        for (const hasPortal of [true, false]) {
          expect(canTransition({ status, move: "SEND", side, hasPortal })).toBe(false);
          expect(canTransition({ status, move: "CLOSE", side, hasPortal })).toBe(false);
        }
      }
    }
  });

  it("принимать можно только отправленное, и строки правит только черновик покупателя", () => {
    expect(canReceive("SHIPPED")).toBe(true);
    expect(canReceive("CONFIRMED")).toBe(false);
    expect(canEditLines("DRAFT", "BUYER")).toBe(true);
    expect(canEditLines("DRAFT", "SUPPLIER")).toBe(false);
    expect(canEditLines("SENT", "BUYER")).toBe(false);
  });
});

describe("разборы и суммы", () => {
  it("количество положительное, цена необязательная", () => {
    expect(parseQty("10")).toBe(10);
    expect(parseQty("1,5")).toBe(1.5);
    expect(parseQty("0")).toBeNull();
    expect(parseQty("-3")).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("12.50")).toBe(12.5);
    expect(parsePrice("abc")).toBe("invalid");
  });

  it("сумма пуста, пока ни у одной строки нет цены", () => {
    expect(orderTotal([{ qty: 2, price: null }])).toBeNull();
    expect(orderTotal([{ qty: 2, price: 3 }, { qty: 1, price: null }])).toBe(6);
  });

  it("остаток строки и полная приёмка", () => {
    expect(remainingQty({ qty: 10, receivedQty: 4 })).toBe(6);
    expect(remainingQty({ qty: 10, receivedQty: 12 })).toBe(0);
    expect(isFullyReceived([{ qty: 5, receivedQty: 5 }])).toBe(true);
    expect(isFullyReceived([{ qty: 5, receivedQty: 4 }])).toBe(false);
    // Пустой заказ полностью принятым не считается: принимать было нечего.
    expect(isFullyReceived([])).toBe(false);
  });
});

describe("поставщик и строки", () => {
  it("своим поставщиком предприятие быть не может", () => {
    const r = validateSupplier(
      { name: "Me", email: null, phone: null, supplierCompanyId: "c1" },
      { count: 0, ownCompanyId: "c1" },
    );
    expect(r).toEqual({ ok: false, reason: "self_supplier" });
  });

  it("имя обязательно, почта проверяется", () => {
    expect(validateSupplier({ name: " ", email: null, phone: null, supplierCompanyId: null }, { count: 0, ownCompanyId: "c" })).toEqual({
      ok: false,
      reason: "name_required",
    });
    expect(
      validateSupplier({ name: "Acme", email: "nope", phone: null, supplierCompanyId: null }, { count: 0, ownCompanyId: "c" }),
    ).toEqual({ ok: false, reason: "email_invalid" });
    expect(validateSupplier({ name: "Acme", email: "a@b.co", phone: null, supplierCompanyId: null }, { count: 0, ownCompanyId: "c" })).toEqual({
      ok: true,
    });
  });

  it("один товар — одна строка", () => {
    expect(validateOrderLine({ qty: 1, productId: "p1" }, { lineCount: 1, productIds: ["p1"] })).toEqual({
      ok: false,
      reason: "duplicate_product",
    });
    expect(validateOrderLine({ qty: 1, productId: "p2" }, { lineCount: MAX_ORDER_LINES, productIds: [] })).toEqual({
      ok: false,
      reason: "too_many_lines",
    });
  });
});

describe("правило автозаказа", () => {
  it("без поставщика правила нет: заявку некому адресовать", () => {
    expect(validateReorderRule({ minQty: 1, targetQty: 5, supplierId: null }, { count: 0 })).toEqual({
      ok: false,
      reason: "supplier_required",
    });
  });

  it("«добирать до» обязано быть больше порога", () => {
    expect(validateReorderRule({ minQty: 5, targetQty: 5, supplierId: "s" }, { count: 0 })).toEqual({
      ok: false,
      reason: "target_not_above_min",
    });
    expect(validateReorderRule({ minQty: 5, targetQty: 20, supplierId: "s" }, { count: 0 })).toEqual({ ok: true });
  });
});

const base: ReorderCandidate = {
  ruleId: "r1",
  companyId: "c1",
  warehouseId: "w1",
  productId: "p1",
  supplierId: "s1",
  minQty: 10,
  targetQty: 50,
  onHand: 4,
  inTransit: 0,
  onOrder: 0,
  hasOpenOrder: false,
};

describe("план автозаказа", () => {
  it("добирает до цели от того, что есть", () => {
    expect(reorderPlan([base])).toEqual([
      { companyId: "c1", supplierId: "s1", warehouseId: "w1", lines: [{ ruleId: "r1", productId: "p1", qty: 46 }] },
    ]);
  });

  it("товар в пути считается наравне с остатком", () => {
    // Иначе прогон каждое утро заказывал бы то, что уже едет.
    expect(reorderPlan([{ ...base, inTransit: 40 }])).toEqual([]);
  });

  it("незакрытый заказ по этой паре молчит целиком", () => {
    expect(reorderPlan([{ ...base, hasOpenOrder: true, onOrder: 100 }])).toEqual([]);
  });

  it("порог не достигнут — заявки нет", () => {
    expect(reorderPlan([{ ...base, onHand: 11 }])).toEqual([]);
    // Ровно на пороге заявка есть: «ниже порога» читается как «не выше».
    expect(reorderPlan([{ ...base, onHand: 10 }])).toHaveLength(1);
  });

  it("одна заявка на поставщика и склад, а не на товар", () => {
    const plans = reorderPlan([
      base,
      { ...base, ruleId: "r2", productId: "p2" },
      { ...base, ruleId: "r3", productId: "p3", supplierId: "s2" },
    ]);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.lines).toHaveLength(2);
    expect(plans[1]?.lines).toHaveLength(1);
  });

  it("разные склады одного поставщика — разные заявки: везти надо туда, где кончилось", () => {
    const plans = reorderPlan([base, { ...base, ruleId: "r2", warehouseId: "w2" }]);
    expect(plans).toHaveLength(2);
  });
});

describe("права раздела", () => {
  it("нет строки — ничего не видно; EDIT включает VIEW", () => {
    expect(supplyRights({})).toEqual({ see: false, manage: false });
    expect(supplyRights({ supply: "VIEW" })).toEqual({ see: true, manage: false });
    expect(supplyRights({ supply: "EDIT" })).toEqual({ see: true, manage: true });
  });
});

describe("выбор в списке, пришедшем позже формы", () => {
  it("значение, которого в списке нет, подменяется первым", () => {
    // Живой прогон BI: на экране стоял поставщик, а в состоянии была пустота первого
    // рендера — действие отвечало «выберите поставщика», и экран врал.
    expect(effectiveOption(["a", "b"], "")).toBe("a");
    expect(effectiveOption(["a", "b"], "b")).toBe("b");
    expect(effectiveOption(["a"], "gone")).toBe("a");
    expect(effectiveOption([], "a")).toBe("");
  });
});
