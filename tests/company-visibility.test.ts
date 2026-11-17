import { describe, expect, it } from "vitest";
import {
  LIVE_CARD_COMPANY,
  PUBLIC_COMPANY,
  REVIEW_NOTICE_DAYS,
  nextReviewAt,
  reviewDueSoon,
} from "@/lib/company-visibility";

describe("видимость компании", () => {
  it("публичная компания — одобренная, не удалённая, не снятая", () => {
    expect(PUBLIC_COMPANY).toEqual({ status: "APPROVED", deletedAt: null, suspendedAt: null });
  });

  it("карточка без компании остаётся видна", () => {
    expect(LIVE_CARD_COMPANY).toEqual({
      OR: [{ companyId: null }, { company: { deletedAt: null, suspendedAt: null } }],
    });
  });
});

describe("пересмотр", () => {
  const base = new Date("2026-11-17T00:00:00Z");

  it("обычный риск — через 12 месяцев, высокий — через 6", () => {
    expect(nextReviewAt(base, "MEDIUM").toISOString()).toBe("2027-11-17T00:00:00.000Z");
    expect(nextReviewAt(base, "LOW").toISOString()).toBe("2027-11-17T00:00:00.000Z");
    expect(nextReviewAt(base, "HIGH").toISOString()).toBe("2027-05-17T00:00:00.000Z");
  });

  it("звонит за 30 дней, не раньше", () => {
    expect(reviewDueSoon(new Date("2026-12-10T00:00:00Z"), base)).toBe(true);
    expect(reviewDueSoon(new Date("2027-01-10T00:00:00Z"), base)).toBe(false);
    // Просроченный пересмотр — тем более повод.
    expect(reviewDueSoon(new Date("2026-10-01T00:00:00Z"), base)).toBe(true);
    expect(reviewDueSoon(null, base)).toBe(false);
    expect(REVIEW_NOTICE_DAYS).toBe(30);
  });
});
