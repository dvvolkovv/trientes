import { describe, expect, it } from "vitest";
import {
  CUSTOMER_BODY_CHARS,
  CUSTOMER_DAILY_MESSAGES,
  CUSTOMER_UNANSWERED,
  canWithdrawCustomerMessage,
  companyAcceptsMessages,
  notifiesStaff,
  unansweredCount,
  unreadForSide,
  validateBlock,
  validateCustomerMessage,
  validateStoreReply,
} from "@/lib/customer-messages/rules";

const live = { blocked: false, companyActive: true, todayCount: 0, unansweredCount: 0 };

describe("дверь снаружи", () => {
  it("открыта только у видимого на витрине предприятия", () => {
    expect(companyAcceptsMessages({ status: "APPROVED", suspendedAt: null, deletedAt: null })).toBe(true);
    expect(companyAcceptsMessages({ status: "PENDING", suspendedAt: null, deletedAt: null })).toBe(false);
    expect(companyAcceptsMessages({ status: "APPROVED", suspendedAt: new Date(), deletedAt: null })).toBe(false);
    expect(companyAcceptsMessages({ status: "APPROVED", suspendedAt: null, deletedAt: new Date() })).toBe(false);
    expect(companyAcceptsMessages(null)).toBe(false);
  });
});

describe("сообщение покупателя", () => {
  it("пустое отвергается, обычное принимается", () => {
    expect(validateCustomerMessage("   ", live)).toMatchObject({ reason: "body_required" });
    expect(validateCustomerMessage("Есть ли зелёный чай?", live).ok).toBe(true);
  });

  it("длина ограничена", () => {
    expect(validateCustomerMessage("x".repeat(CUSTOMER_BODY_CHARS + 1), live)).toMatchObject({
      reason: "body_too_long",
    });
  });

  it("блокировка и снятое предприятие старше потолков и формы текста", () => {
    expect(validateCustomerMessage("", { ...live, blocked: true })).toMatchObject({ reason: "blocked" });
    expect(validateCustomerMessage("", { ...live, companyActive: false })).toMatchObject({
      reason: "company_inactive",
    });
  });

  it("суточный потолок считается на покупателя", () => {
    expect(validateCustomerMessage("ещё", { ...live, todayCount: CUSTOMER_DAILY_MESSAGES })).toMatchObject({
      reason: "daily_limit",
    });
  });

  it("поток в тишину останавливается", () => {
    expect(validateCustomerMessage("ещё", { ...live, unansweredCount: CUSTOMER_UNANSWERED })).toMatchObject({
      reason: "unanswered_limit",
    });
    expect(validateCustomerMessage("ещё", { ...live, unansweredCount: CUSTOMER_UNANSWERED - 1 }).ok).toBe(true);
  });
});

describe("ответ магазина", () => {
  it("потолками покупателя не связан, но снятое предприятие не отвечает", () => {
    expect(validateStoreReply("Есть, приходите", { companyActive: true }).ok).toBe(true);
    expect(validateStoreReply("Есть", { companyActive: false })).toMatchObject({ reason: "company_inactive" });
    expect(validateStoreReply(" ", { companyActive: true })).toMatchObject({ reason: "body_required" });
  });
});

describe("непрочитанное по стороне", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 20, 12, min));
  const rows = [
    { side: "CUSTOMER" as const, createdAt: t(0), deletedAt: null },
    { side: "STORE" as const, createdAt: t(5), deletedAt: null },
    { side: "CUSTOMER" as const, createdAt: t(9), deletedAt: null },
    { side: "CUSTOMER" as const, createdAt: t(10), deletedAt: t(11) },
  ];

  it("свои не считаются, отозванные не считаются", () => {
    expect(unreadForSide(rows, "STORE", null)).toBe(2);
    expect(unreadForSide(rows, "CUSTOMER", null)).toBe(1);
  });

  it("штамп прочтения гасит прежние строки", () => {
    expect(unreadForSide(rows, "STORE", t(9))).toBe(0);
    expect(unreadForSide(rows, "STORE", t(1))).toBe(1);
  });
});

describe("свои сообщения без ответа", () => {
  it("считаются до первой строки магазина", () => {
    expect(unansweredCount([{ side: "CUSTOMER" }, { side: "CUSTOMER" }, { side: "STORE" }, { side: "CUSTOMER" }])).toBe(2);
    expect(unansweredCount([{ side: "STORE" }])).toBe(0);
    expect(unansweredCount([])).toBe(0);
  });
});

describe("отзыв сообщения", () => {
  const storeMsg = { side: "STORE" as const, authorUserId: "u1", deletedAt: null };
  const customerMsg = { side: "CUSTOMER" as const, authorUserId: "c1", deletedAt: null };

  it("своё отзывает автор", () => {
    expect(canWithdrawCustomerMessage(storeMsg, { userId: "u1", side: "STORE", isOwner: false })).toBe(true);
    expect(canWithdrawCustomerMessage(storeMsg, { userId: "u2", side: "STORE", isOwner: false })).toBe(false);
  });

  it("слово магазина отзывает и владелец", () => {
    expect(canWithdrawCustomerMessage(storeMsg, { userId: "u2", side: "STORE", isOwner: true })).toBe(true);
  });

  it("слова покупателя магазин не отзывает — у него есть блокировка", () => {
    expect(canWithdrawCustomerMessage(customerMsg, { userId: "u1", side: "STORE", isOwner: true })).toBe(false);
    expect(canWithdrawCustomerMessage(customerMsg, { userId: "c1", side: "CUSTOMER", isOwner: false })).toBe(true);
  });

  it("закрытый блокировкой разговор покупатель не правит, магазин правит", () => {
    expect(
      canWithdrawCustomerMessage(customerMsg, { userId: "c1", side: "CUSTOMER", isOwner: false, threadBlocked: true }),
    ).toBe(false);
    expect(
      canWithdrawCustomerMessage(storeMsg, { userId: "u1", side: "STORE", isOwner: false, threadBlocked: true }),
    ).toBe(true);
  });

  it("отозванное второй раз не отзывается", () => {
    expect(
      canWithdrawCustomerMessage({ ...storeMsg, deletedAt: new Date() }, { userId: "u1", side: "STORE", isOwner: true }),
    ).toBe(false);
  });
});

describe("блокировка", () => {
  it("причина необязательна, но короткая не причина", () => {
    expect(validateBlock(null).ok).toBe(true);
    expect(validateBlock("").ok).toBe(true);
    expect(validateBlock("ok").ok).toBe(false);
    expect(validateBlock("мат в каждом слове").ok).toBe(true);
  });
});

describe("уведомление сотрудникам", () => {
  it("уходит только на начало разговора", () => {
    expect(notifiesStaff({ storeUnreadBefore: 0 })).toBe(true);
    expect(notifiesStaff({ storeUnreadBefore: 1 })).toBe(false);
  });
});
