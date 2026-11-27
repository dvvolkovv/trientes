import { describe, expect, it } from "vitest";
import { sweepVerdict } from "@/lib/pay-link/sweep";
import type { LinkOutcome } from "@/lib/pay-link/service";

const ok = (merchantId: string): LinkOutcome => ({
  kind: "ok",
  info: {
    merchantId,
    merchant: "Coffee House",
    title: "Order",
    rawTitle: "Order",
    unit: "usd",
    coinSymbol: null,
    amount: "20.00",
  },
});

describe("суточная проверка ссылки", () => {
  it("ссылка жива и магазин тот же — ничего не меняем", () => {
    expect(sweepVerdict(ok("m_aaa"), "m_aaa")).toBe("ok");
  });

  it("404 — кнопку скрыть", () => {
    expect(sweepVerdict({ kind: "missing" }, "m_aaa")).toBe("hidden");
  });

  it("выключена в кабинете — пометка владельцу, кнопку не трогаем", () => {
    expect(sweepVerdict({ kind: "off" }, "m_aaa")).toBe("disabled");
  });

  it("чужой номер магазина — скрыть и поднять тревогу", () => {
    expect(sweepVerdict(ok("m_bbb"), "m_aaa")).toBe("mismatch");
  });

  it("молчание службы — сбой связи, прежние числа остаются", () => {
    // Иначе молчащая служба погасила бы кнопки всех магазинов разом.
    expect(sweepVerdict({ kind: "later" }, "m_aaa")).toBe("later");
  });
});
