import { describe, expect, it } from "vitest";
import { productLadder, ladderProgress, type LadderInput } from "@/lib/products/ladder";

const full: LadderInput = {
  passport: { name: "Чай", category: "food", description: "Чёрный листовой чай, сто грамм, Шри-Ланка", photoCount: 1, gtin: "5449000000996" },
  offer: { price: 10, unit: "pcs", active: true },
  stockQty: 12,
  cashbackPercent: 3,
  promoCount: 1,
  reorderRules: 1,
};

function step(input: LadderInput, key: string) {
  return productLadder(input).find((s) => s.key === key)!;
}

describe("лестница настройки товара", () => {
  it("всё заполнено — все шесть ступеней пройдены", () => {
    expect(ladderProgress(productLadder(full))).toEqual({ done: 6, total: 6 });
  });

  it("товара ещё нет — первая ступень ждёт, остальное зависимое заблокировано", () => {
    const empty: LadderInput = {
      passport: null, offer: null, stockQty: 0, cashbackPercent: null, promoCount: 0, reorderRules: 0,
    };
    expect(step(empty, "passport").state).toBe("todo");
    expect(step(empty, "where").state).toBe("blocked");
    expect(step(empty, "where").blockedBy).toBe("offer");
  });

  it("паспорт не блокирует цену: цена у товара без фотографии работает", () => {
    const noPhoto = { ...full, passport: { ...full.passport!, photoCount: 0 } };
    expect(step(noPhoto, "passport").state).toBe("todo");
    expect(step(noPhoto, "offer").state).toBe("done");
    expect(step(noPhoto, "where").state).toBe("done");
  });

  it("без цены кэшбэк и акция заблокированы — показать покупателю нечего", () => {
    const noOffer = { ...full, offer: null };
    expect(step(noOffer, "cashback").state).toBe("blocked");
    expect(step(noOffer, "promo").state).toBe("blocked");
    expect(step(noOffer, "cashback").blockedBy).toBe("offer");
  });

  it("предложение на паузе ценой не считается", () => {
    const paused = { ...full, offer: { price: 10, unit: "pcs", active: false } };
    expect(step(paused, "offer").state).toBe("todo");
    expect(step(paused, "offer").missing).toEqual(["paused"]);
    expect(step(paused, "where").state).toBe("blocked");
  });

  it("поставка живёт сама по себе: склад наполняют раньше витрины", () => {
    const noOffer = { ...full, offer: null, reorderRules: 1 };
    expect(step(noOffer, "supply").state).toBe("done");
  });

  it("нет остатка, но цена есть — ступень ждёт, а не заблокирована", () => {
    expect(step({ ...full, stockQty: 0 }, "where").state).toBe("todo");
  });

  it("описание-заглушка не считается описанием", () => {
    const short = { ...full, passport: { ...full.passport!, description: "Чай" } };
    expect(step(short, "passport").missing).toEqual(["description"]);
  });
});
