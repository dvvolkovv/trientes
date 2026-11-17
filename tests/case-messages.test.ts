import { describe, expect, it } from "vitest";
import {
  MESSAGE_MAX,
  normalizeBody,
  statusAfterApplicantMessage,
  statusAfterStaffMessage,
  unreadCount,
  TEMPLATE_KEYS,
} from "@/lib/cases/messages";

describe("normalizeBody", () => {
  it("срезает пробелы и приводит переводы строк", () => {
    const r = normalizeBody("  привет\r\nмир  ", false);
    expect(r).toEqual({ ok: true, body: "привет\nмир" });
  });

  it("пустой текст без вложения не сообщение", () => {
    expect(normalizeBody("   ", false)).toEqual({ ok: false, reason: "empty" });
  });

  it("пустой текст с вложением разрешён — файл и есть сообщение", () => {
    expect(normalizeBody("", true)).toEqual({ ok: true, body: "" });
  });

  it("слишком длинный текст отвергается, а не обрезается молча", () => {
    expect(normalizeBody("a".repeat(MESSAGE_MAX + 1), false)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("unreadCount", () => {
  const msgs = [
    { side: "APPLICANT" as const, readByStaffAt: null, readByApplicantAt: new Date() },
    { side: "APPLICANT" as const, readByStaffAt: new Date(), readByApplicantAt: new Date() },
    { side: "STAFF" as const, readByStaffAt: new Date(), readByApplicantAt: null },
  ];

  it("сотруднику непрочитано то, что написал заявитель", () => {
    expect(unreadCount(msgs, "STAFF")).toBe(1);
  });

  it("заявителю непрочитано то, что написали мы", () => {
    expect(unreadCount(msgs, "APPLICANT")).toBe(1);
  });

  it("своё непрочитанным не считается", () => {
    expect(unreadCount([{ side: "STAFF", readByStaffAt: null, readByApplicantAt: new Date() }], "STAFF")).toBe(0);
  });
});

describe("statusAfterStaffMessage", () => {
  it("вопрос заявителю переводит дело в ожидание", () => {
    expect(statusAfterStaffMessage("IN_REVIEW", true)).toBe("WAITING_APPLICANT");
    expect(statusAfterStaffMessage("NEW", true)).toBe("WAITING_APPLICANT");
  });

  it("приписка без ожидания ответа статуса не трогает", () => {
    expect(statusAfterStaffMessage("IN_REVIEW", false)).toBeNull();
  });

  it("уже ждём — ничего не меняется, часы не встают дважды", () => {
    expect(statusAfterStaffMessage("WAITING_APPLICANT", true)).toBeNull();
  });

  it("решённое дело сообщением не открывается заново", () => {
    expect(statusAfterStaffMessage("APPROVED", true)).toBeNull();
    expect(statusAfterStaffMessage("REJECTED", true)).toBeNull();
    expect(statusAfterStaffMessage("CLOSED", true)).toBeNull();
  });
});

describe("statusAfterApplicantMessage", () => {
  it("ответ заявителя возвращает дело в работу", () => {
    expect(statusAfterApplicantMessage("WAITING_APPLICANT")).toBe("IN_REVIEW");
  });

  it("неразобранное дело ответом в работу не попадает — его никто не взял", () => {
    expect(statusAfterApplicantMessage("NEW")).toBeNull();
  });

  it("решённое дело ответом не открывается", () => {
    expect(statusAfterApplicantMessage("CLOSED")).toBeNull();
  });
});

describe("TEMPLATE_KEYS", () => {
  it("четыре заготовки в одно нажатие", () => {
    expect(TEMPLATE_KEYS).toEqual(["requestDocument", "clarifyData", "needTranslation", "deadline7"]);
  });
});
