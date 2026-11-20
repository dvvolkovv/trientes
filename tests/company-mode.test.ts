import { describe, expect, it } from "vitest";
import { companyMode } from "@/lib/company-mode";

const none = { offlinePoints: 0, onlinePoints: 0, onlineStockShelves: 0 };

describe("тип магазина", () => {
  it("точка на карте — офлайн", () => {
    expect(companyMode({ ...none, offlinePoints: 2 })).toBe("offline");
  });

  it("точка без адреса — онлайн", () => {
    expect(companyMode({ ...none, onlinePoints: 1 })).toBe("online");
  });

  it("онлайн-полка с товаром — тоже онлайн", () => {
    expect(companyMode({ ...none, onlineStockShelves: 1 })).toBe("online");
  });

  it("и то и другое — смешанный", () => {
    expect(companyMode({ offlinePoints: 1, onlinePoints: 0, onlineStockShelves: 3 })).toBe("mixed");
  });

  // Сайт магазином не считается: предприятие, которое ещё ничего о себе не сказало,
  // не должно выглядеть онлайн-магазином.
  it("ничего нет — тип не выдумывается", () => {
    expect(companyMode(none)).toBe("none");
  });
});
