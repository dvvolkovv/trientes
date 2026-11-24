import { describe, it, expect } from "vitest";
import { SHARE_TARGETS, shareMessage, shareTargetHref } from "@/lib/share-targets";

const SHARE = {
  title: "Trientes — приглашение",
  text: "Вас приглашают в команду «Чайная лавка».",
  url: "https://trientes.org/ru/invite/abc123",
};

describe("shareMessage", () => {
  it("ставит ссылку в конец текста", () => {
    expect(shareMessage(SHARE)).toBe(`${SHARE.text}\n${SHARE.url}`);
  });

  it("без текста отдаёт одну ссылку, без лишнего перевода строки", () => {
    expect(shareMessage({ url: SHARE.url })).toBe(SHARE.url);
    expect(shareMessage({ url: SHARE.url, text: "  " })).toBe(SHARE.url);
  });
});

describe("shareTargetHref", () => {
  it("почта несёт заголовок темой и ссылку телом", () => {
    const href = shareTargetHref("email", SHARE);
    expect(href.startsWith("mailto:?")).toBe(true);
    const q = new URLSearchParams(href.slice("mailto:?".length));
    expect(q.get("subject")).toBe(SHARE.title);
    expect(q.get("body")).toBe(shareMessage(SHARE));
  });

  it("почта без заголовка темы не ставит", () => {
    expect(shareTargetHref("email", { url: SHARE.url })).toBe(
      `mailto:?body=${encodeURIComponent(SHARE.url)}`,
    );
  });

  it("СМС собирается видом, который понимают и iOS, и Android", () => {
    // `sms:?&body=` — единственная запись, которую берут обе системы:
    // iOS не понимает `?body=`, Android не понимает `&body=` без знака вопроса.
    expect(shareTargetHref("sms", SHARE)).toBe(
      `sms:?&body=${encodeURIComponent(shareMessage(SHARE))}`,
    );
  });

  it("Telegram получает ссылку и текст разными полями", () => {
    const href = shareTargetHref("telegram", SHARE);
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe(SHARE.url);
    // Ссылку Telegram подставляет сам из `url` — во `text` её повторять нельзя.
    expect(u.searchParams.get("text")).toBe(SHARE.text);
  });

  it("WhatsApp берёт всё одной строкой", () => {
    const u = new URL(shareTargetHref("whatsapp", SHARE));
    expect(u.origin + u.pathname).toBe("https://wa.me/");
    expect(u.searchParams.get("text")).toBe(shareMessage(SHARE));
  });

  it("у каждой цели есть ссылка и собственное имя ключа", () => {
    const keys = SHARE_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const target of SHARE_TARGETS) {
      expect(shareTargetHref(target.key, SHARE).length).toBeGreaterThan(10);
    }
  });

  it("кавычки и амперсанды уезжают закодированными", () => {
    const href = shareTargetHref("whatsapp", {
      url: "https://trientes.org/ru/invite/t?a=1&b=2",
      text: 'Команда «Чай & Кофе»',
    });
    expect(href).not.toContain("«");
    expect(new URL(href).searchParams.get("text")).toContain("«Чай & Кофе»");
  });
});
