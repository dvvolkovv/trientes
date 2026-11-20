import { describe, expect, it } from "vitest";
import {
  MERCHANT_CATEGORIES,
  categoryInterest,
  effectiveCategory,
  isMerchantCategory,
} from "@/lib/merchant-categories";
import { INTEREST_KEYS } from "@/lib/interests";

describe("вид заведения", () => {
  it("уточнение точки сильнее категории предприятия", () => {
    expect(effectiveCategory("cafe", "fuel")).toBe("cafe");
    expect(effectiveCategory(null, "fuel")).toBe("fuel");
    expect(effectiveCategory("", "fuel")).toBe("fuel");
  });

  it("нет вида ни у точки, ни у предприятия — значит нет", () => {
    expect(effectiveCategory(null, null)).toBeNull();
  });

  // Выдуманный ключ не должен проходить дальше: он покрасит булавку и попадёт в
  // интересы маршрута, то есть соврёт покупателю о том, что это за место.
  it("незнакомый ключ не считается видом", () => {
    expect(isMerchantCategory("casino")).toBe(false);
    expect(effectiveCategory("casino", "cafe")).toBe("cafe");
    expect(categoryInterest("casino")).toBeNull();
  });

  it("у каждого вида есть интерес из оси маршрутов", () => {
    for (const c of MERCHANT_CATEGORIES) {
      expect(INTEREST_KEYS, c.key).toContain(c.interest);
      expect(c.emoji.length).toBeGreaterThan(0);
    }
  });

  it("ключи не повторяются", () => {
    const keys = MERCHANT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("заправка и зарядка относятся к топливу, обменник и банкомат — к наличным", () => {
    expect(categoryInterest("fuel")).toBe("fuel");
    expect(categoryInterest("charging")).toBe("fuel");
    expect(categoryInterest("exchange")).toBe("cash");
    expect(categoryInterest("atm")).toBe("cash");
    expect(categoryInterest("hotel")).toBe("lodging");
  });
});
