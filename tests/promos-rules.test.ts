import { describe, expect, it } from "vitest";
import {
  PROMO_TEXT_MAX,
  PROMO_TITLE_MAX,
  parsePromoInput,
  promoVisible,
  promoWindow,
} from "@/lib/promos/rules";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-19T12:00:00.000Z");
const tomorrow = new Date(now.getTime() + day);
const base = {
  title: "Скидка на кофе",
  body: "Всю неделю кофе дешевле на 20 процентов.",
  startsAt: "2026-11-19",
  endsAt: "2026-11-30",
};

describe("parsePromoInput", () => {
  it("accepts a plain promo and keeps the text as written", () => {
    const parsed = parsePromoInput(base, now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBe("Скидка на кофе");
    expect(parsed.value.body).toBe("Всю неделю кофе дешевле на 20 процентов.");
  });

  it("rejects an empty title and an empty body", () => {
    expect(parsePromoInput({ ...base, title: " " }, now)).toEqual({ ok: false, reason: "title_required" });
    expect(parsePromoInput({ ...base, body: "  " }, now)).toEqual({ ok: false, reason: "body_required" });
  });

  it("rejects text longer than the ceiling", () => {
    expect(parsePromoInput({ ...base, body: "я".repeat(PROMO_TEXT_MAX + 1) }, now).ok).toBe(false);
    expect(parsePromoInput({ ...base, title: "я".repeat(PROMO_TITLE_MAX + 1) }, now).ok).toBe(false);
  });

  // Ссылка в сообщении от незнакомого магазина — дверь для фишинга, а придёт оно из
  // нашего бота: отвечать за неё будем мы.
  it("rejects any link in the text, however written", () => {
    for (const body of [
      "Заходите на https://evil.example",
      "Заходите на http://evil.example",
      "Пишите в t.me/evilshop",
      "Подробности на evil.example/sale",
      "Напишите на shop@evil.example",
      "Адрес: WWW.EVIL.EXAMPLE",
    ]) {
      expect(parsePromoInput({ ...base, body }, now), body).toEqual({
        ok: false,
        reason: "text_has_link",
      });
    }
  });

  it("does not mistake ordinary prose for a link", () => {
    for (const body of [
      "Скидка 20% на всё. Ждём вас!",
      "Цена 10,50 EUR за кг.",
      "Акция с 1.12 по 5.12 включительно.",
    ]) {
      expect(parsePromoInput({ ...base, body }, now).ok, body).toBe(true);
    }
  });

  it("requires a window that ends after it starts and is not already over", () => {
    expect(parsePromoInput({ ...base, startsAt: "2026-11-30", endsAt: "2026-11-20" }, now)).toEqual({
      ok: false,
      reason: "window_backwards",
    });
    expect(parsePromoInput({ ...base, startsAt: "2026-11-01", endsAt: "2026-11-10" }, now)).toEqual({
      ok: false,
      reason: "window_past",
    });
    expect(parsePromoInput({ ...base, startsAt: "bogus", endsAt: "2026-11-20" }, now)).toEqual({
      ok: false,
      reason: "window_invalid",
    });
  });

  // Срок — дата, а не час: часового пояса у предприятия в данных нет (решение BF).
  it("takes the window as whole days, end inclusive", () => {
    const parsed = parsePromoInput(base, now);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.startsAt.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(parsed.value.endsAt.toISOString()).toBe("2026-11-30T23:59:59.999Z");
  });

  it("rejects a window longer than the ceiling", () => {
    expect(parsePromoInput({ ...base, endsAt: "2027-11-30" }, now)).toEqual({ ok: false, reason: "window_too_long" });
  });
});

describe("promoWindow", () => {
  it("tells running, upcoming and finished apart", () => {
    const promo = { startsAt: now, endsAt: tomorrow };
    expect(promoWindow(promo, now)).toBe("running");
    expect(promoWindow({ startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + day) }, now)).toBe("upcoming");
    expect(promoWindow({ startsAt: new Date(now.getTime() - 2 * day), endsAt: new Date(now.getTime() - day) }, now)).toBe("finished");
  });
});

describe("promoVisible", () => {
  const company = { status: "APPROVED" as const, suspendedAt: null, deletedAt: null };
  const promo = { startsAt: now, endsAt: tomorrow, archivedAt: null };

  it("shows a running promo of a listed company", () => {
    expect(promoVisible({ company, promo }, now)).toBe(true);
  });

  it("hides it when any of the existing supervisions bites", () => {
    expect(promoVisible({ company: { ...company, status: "PENDING" }, promo }, now)).toBe(false);
    expect(promoVisible({ company: { ...company, suspendedAt: now }, promo }, now)).toBe(false);
    expect(promoVisible({ company: { ...company, deletedAt: now }, promo }, now)).toBe(false);
  });

  it("hides an archived, finished or not-yet-started promo", () => {
    expect(promoVisible({ company, promo: { ...promo, archivedAt: now } }, now)).toBe(false);
    expect(promoVisible({ company, promo: { ...promo, endsAt: new Date(now.getTime() - 1) } }, now)).toBe(false);
    expect(promoVisible({ company, promo: { ...promo, startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + day) } }, now)).toBe(false);
  });
});
