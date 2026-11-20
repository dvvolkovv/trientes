import { describe, expect, it } from "vitest";
import {
  CHAT_BODY_CHARS,
  CHAT_DAILY_MESSAGES,
  canWithdraw,
  chatRightsFor,
  isMentionable,
  parseMentions,
  unreadFrom,
  validateMessage,
} from "@/lib/company-chat/rules";

/**
 * Спека `docs/superpowers/specs/2026-11-20-merchant-team-chat-design.md`.
 * Решения, которые тест держит: комната принадлежит команде (наблюдатель пишет),
 * упоминание зовёт только члена, непрочитанное личное, отзыв — автору и владельцу.
 */

const live = { suspendedAt: null, deletedAt: null };

describe("права на комнату", () => {
  it("читают и пишут все члены, включая наблюдателя", () => {
    // Наблюдатель, который не может задать вопрос, — не наблюдатель (§ 2.2).
    expect(chatRightsFor(live)).toEqual({ read: true, post: true });
  });

  it("не члену не видно ничего", () => {
    expect(chatRightsFor(null)).toEqual({ read: false, post: false });
  });

  it("снятое надзором предприятие только читает", () => {
    expect(chatRightsFor({ suspendedAt: new Date(), deletedAt: null })).toEqual({ read: true, post: false });
    expect(chatRightsFor({ suspendedAt: null, deletedAt: new Date() })).toEqual({ read: true, post: false });
  });
});

describe("проверка сообщения", () => {
  const ctx = { todayCount: 0 };

  it("пустое и из одних пробелов отвергаются", () => {
    expect(validateMessage("", ctx)).toEqual({ ok: false, reason: "body_required" });
    expect(validateMessage("   \n  ", ctx)).toEqual({ ok: false, reason: "body_required" });
  });

  it("слишком длинное отвергается вслух", () => {
    expect(validateMessage("x".repeat(CHAT_BODY_CHARS), ctx)).toEqual({ ok: true });
    expect(validateMessage("x".repeat(CHAT_BODY_CHARS + 1), ctx)).toEqual({ ok: false, reason: "body_too_long" });
  });

  it("суточный предел считается до записи", () => {
    expect(validateMessage("привет", { todayCount: CHAT_DAILY_MESSAGES - 1 })).toEqual({ ok: true });
    expect(validateMessage("привет", { todayCount: CHAT_DAILY_MESSAGES })).toEqual({
      ok: false,
      reason: "daily_limit",
    });
  });
});

describe("упоминания", () => {
  const members = [
    { userId: "u-marina", username: "marina" },
    { userId: "u-oleg", username: "Oleg_K" },
    { userId: "u-me", username: "boss" },
  ];
  const me = "u-me";

  it("зовёт члена команды без учёта регистра", () => {
    expect(parseMentions("@MARINA посмотри полку", members, me)).toEqual(["u-marina"]);
    expect(parseMentions("@oleg_k где чай?", members, me)).toEqual(["u-oleg"]);
  });

  it("знак препинания границу слова не портит", () => {
    expect(parseMentions("спроси @marina, она знает", members, me)).toEqual(["u-marina"]);
    expect(parseMentions("(@marina)", members, me)).toEqual(["u-marina"]);
  });

  it("повтор зовёт один раз", () => {
    expect(parseMentions("@marina @marina @marina", members, me)).toEqual(["u-marina"]);
  });

  it("себя не зовёт: уведомление о своих же словах бессмысленно", () => {
    expect(parseMentions("@boss сам себе", members, me)).toEqual([]);
  });

  it("чужой логин — просто текст", () => {
    // Упоминание не члена никого не зовёт и ничего не обещает (§ 2.4).
    expect(parseMentions("@elonmusk купи нам склад", members, me)).toEqual([]);
  });

  it("@all не заводим: кнопки «разбудить всех» в чате нет", () => {
    expect(parseMentions("@all срочно", members, me)).toEqual([]);
    expect(parseMentions("@все срочно", members, me)).toEqual([]);
  });

  it("логин внутри слова упоминанием не считается", () => {
    expect(parseMentions("mail@marina.ru", members, me)).toEqual([]);
  });

  it("логин, который разбор не поймает, чипом не предлагается", () => {
    // Живой прогон BP: тестовые логины были с дефисами, и чип вставлял `@bp-live-keeper`,
    // который никого не звал. Класс знаков у чипа и у разбора теперь один.
    expect(isMentionable("marina")).toBe(true);
    expect(isMentionable("ole_g9")).toBe(true);
    expect(isMentionable("bp-live-keeper")).toBe(false);
    expect(isMentionable(null)).toBe(false);
    expect(parseMentions("@bp-live-keeper", [{ userId: "u-x", username: "bp-live-keeper" }], "u-me")).toEqual([]);
  });

  it("несколько разных членов зовутся по порядку", () => {
    expect(parseMentions("@oleg_k и @marina", members, me)).toEqual(["u-oleg", "u-marina"]);
  });
});

describe("отзыв сообщения", () => {
  const mine = { authorUserId: "u-me", deletedAt: null };
  const theirs = { authorUserId: "u-other", deletedAt: null };

  it("своё отзывает автор", () => {
    expect(canWithdraw(mine, { userId: "u-me", isOwner: false })).toBe(true);
  });

  it("чужое отзывает только владелец", () => {
    expect(canWithdraw(theirs, { userId: "u-me", isOwner: false })).toBe(false);
    expect(canWithdraw(theirs, { userId: "u-me", isOwner: true })).toBe(true);
  });

  it("уже отозванное не отзывается повторно", () => {
    expect(canWithdraw({ ...mine, deletedAt: new Date() }, { userId: "u-me", isOwner: true })).toBe(false);
  });

  it("сообщение уволенного автора отзывает владелец", () => {
    expect(canWithdraw({ authorUserId: null, deletedAt: null }, { userId: "u-me", isOwner: true })).toBe(true);
    expect(canWithdraw({ authorUserId: null, deletedAt: null }, { userId: "u-me", isOwner: false })).toBe(false);
  });
});

describe("непрочитанное", () => {
  const at = (iso: string) => new Date(iso);
  const rows = [
    { authorUserId: "u-other", createdAt: at("2026-11-20T10:00:00Z"), deletedAt: null },
    { authorUserId: "u-me", createdAt: at("2026-11-20T11:00:00Z"), deletedAt: null },
    { authorUserId: "u-other", createdAt: at("2026-11-20T12:00:00Z"), deletedAt: null },
    { authorUserId: "u-other", createdAt: at("2026-11-20T13:00:00Z"), deletedAt: at("2026-11-20T13:05:00Z") },
  ];

  it("считает чужие неотозванные после часа чтения", () => {
    expect(unreadFrom(rows, { userId: "u-me", lastReadAt: at("2026-11-20T11:30:00Z") })).toBe(1);
  });

  it("никогда не читавший видит всё чужое", () => {
    expect(unreadFrom(rows, { userId: "u-me", lastReadAt: null })).toBe(2);
  });

  it("свои сообщения непрочитанными не бывают", () => {
    expect(unreadFrom(rows, { userId: "u-other", lastReadAt: null })).toBe(1);
  });

  it("прочитавший всё видит ноль", () => {
    expect(unreadFrom(rows, { userId: "u-me", lastReadAt: at("2026-11-20T23:00:00Z") })).toBe(0);
  });
});
