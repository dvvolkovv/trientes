import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { COMPANY_TILES } from "@/lib/cabinet/company-nav";
import { KNOWN_ERRORS } from "@/components/business/pay-link-section";

/**
 * Код без слов выходит на экран кодом (прецедент `merchant-labels`). У приёма платежей
 * таких словарей три: отказы действия, виды строк журнала и вести владельцу — и каждый
 * читает человек, у которого в этот момент на кону деньги покупателей.
 */

/** Исходы `CompanyPayLinkChange.action`. Список руками: журнал неизменяем. */
const JOURNAL = ["SET", "SCHEDULED", "APPLIED", "CANCELLED", "REMOVED", "DISABLED", "HIDDEN"];

/** Вести, которые шлёт слайс. Ключи зовутся строками из кода, поэтому сверяем списком. */
const NOTIFY = [
  "installed", "sameMerchant", "scheduled", "applied", "cancelled", "changeFailed",
  "removed", "missing", "disabled", "mismatch", "reset",
];

const pay = (en as Record<string, any>).payLink as Record<string, any>;

describe("слова приёма платежей", () => {
  it("у каждого отказа есть своя фраза", () => {
    for (const reason of KNOWN_ERRORS) expect(pay.error[reason], reason).toBeTruthy();
    expect(pay.error.generic).toBeTruthy();
  });

  it("в переводах нет фраз для отказов, которых в коде больше нет", () => {
    const known = new Set([...KNOWN_ERRORS, "generic"]);
    expect(Object.keys(pay.error).filter((k) => !known.has(k))).toEqual([]);
  });

  it("у каждой строки журнала есть фраза", () => {
    for (const action of JOURNAL) expect(pay.journal[action], action).toBeTruthy();
    expect(Object.keys(pay.journal).filter((k) => !JOURNAL.includes(k))).toEqual([]);
  });

  it("у каждой вести есть заголовок и тело", () => {
    for (const key of NOTIFY) {
      expect(pay.notify[key]?.subject, `${key}.subject`).toBeTruthy();
      expect(pay.notify[key]?.body, `${key}.body`).toBeTruthy();
    }
  });

  it("весть о смене канала говорит, что это за канал", () => {
    expect(pay.notify.contactChanged.subject).toBeTruthy();
    expect(pay.notify.contactChanged.body.email).toBeTruthy();
    expect(pay.notify.contactChanged.body.telegram).toBeTruthy();
  });

  it("кнопка «Оплатить» и шаги подключения названы", () => {
    for (const key of ["payButton", "connect", "check", "confirmYes", "getCode", "amountFree"]) {
      expect(pay[key], key).toBeTruthy();
    }
  });

  it("у плитки приёма платежей есть подпись, и она видна только владельцу", () => {
    const tile = COMPANY_TILES.find((t) => t.key === "payments");
    expect(tile).toBeTruthy();
    // Право, которым меняется получатель денег, ролями не настраивается (решение BE).
    expect(tile!.ownerOnly).toBe(true);
    expect((en as Record<string, any>).business.tiles.payments).toBeTruthy();
  });
});

describe("слова подтверждения личности", () => {
  const reauth = (en as Record<string, any>).reauth as Record<string, any>;
  it("оба пути названы: код и пароль, плюс выход для записи без обоих", () => {
    for (const key of ["codeBody", "codeLabel", "passwordBody", "passwordLabel", "signoutBody", "confirm"]) {
      expect(reauth[key], key).toBeTruthy();
    }
  });
});
