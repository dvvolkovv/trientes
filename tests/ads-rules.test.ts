import { describe, expect, it } from "vitest";
import { adInWindow, adVisible, isOwnMedia, parseAdInput, type AdInput } from "@/lib/ads/rules";

const MEDIA = "/uploads/ads/cmwcompany1/0123456789abcdef0123456789abcdef.jpg";

const base: AdInput = {
  kind: "PROMO",
  title: "Проект дома за 7 дней",
  body: "Бесплатная смета до конца ноября.",
  language: "ru",
  mediaKind: "IMAGE",
  mediaUrl: MEDIA,
  action: "NONE",
};

describe("рекламный материал: разбор ввода", () => {
  it("принимает материал с кадром и текстом", () => {
    const r = parseAdInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toBe("Проект дома за 7 дней");
  });

  it("без кадра отказывает: баннер — это кадр", () => {
    expect(parseAdInput({ ...base, mediaUrl: "" })).toMatchObject({ ok: false, reason: "media_required" });
  });

  it("чужой адрес кадром не считает", () => {
    // Чужая картинка исчезнет в день, когда её уберут, и унесёт с собой баннер.
    expect(parseAdInput({ ...base, mediaUrl: "https://example.org/a.jpg" }))
      .toMatchObject({ ok: false, reason: "media_invalid" });
    expect(isOwnMedia(MEDIA)).toBe(true);
    expect(isOwnMedia("/uploads/points/x/abc.jpg")).toBe(false);
  });

  it("ссылку в тексте отвергает вслух: текст читает голос", () => {
    expect(parseAdInput({ ...base, body: "Подробности на arcon.ch" }))
      .toMatchObject({ ok: false, reason: "text_has_link" });
  });

  it("событию нужна дата, иначе это не событие", () => {
    expect(parseAdInput({ ...base, kind: "EVENT" })).toMatchObject({ ok: false, reason: "event_required" });
    expect(parseAdInput({ ...base, kind: "EVENT", eventAt: "2026-12-01" }).ok).toBe(true);
  });

  it("срок задом наперёд отвергает, а пустой срок принимает", () => {
    expect(parseAdInput({ ...base, startsAt: "2026-12-10", endsAt: "2026-12-01" }))
      .toMatchObject({ ok: false, reason: "window_backwards" });
    expect(parseAdInput({ ...base, startsAt: "", endsAt: "" }).ok).toBe(true);
  });

  it("у действия должен быть адресат", () => {
    expect(parseAdInput({ ...base, action: "PRODUCT" })).toMatchObject({ ok: false, reason: "product_required" });
    expect(parseAdInput({ ...base, action: "WEBSITE", actionUrl: "http://a.example" }))
      .toMatchObject({ ok: false, reason: "url_invalid" });
    expect(parseAdInput({ ...base, action: "WEBSITE", actionUrl: "https://arcon.example" }).ok).toBe(true);
  });
});

describe("рекламный материал: видимость", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  const live = { status: "APPROVED", suspendedAt: null, deletedAt: null };

  it("пустой срок — показывается, пока опубликован", () => {
    expect(adInWindow({ startsAt: null, endsAt: null }, now)).toBe(true);
  });

  it("закончившийся срок гасит материал", () => {
    expect(adInWindow({ startsAt: null, endsAt: new Date("2026-11-21T00:00:00.000Z") }, now)).toBe(false);
  });

  it("снятое надзором предприятие гасит рекламу", () => {
    const ad = { status: "PUBLISHED", startsAt: null, endsAt: null };
    expect(adVisible({ company: live, ad }, now)).toBe(true);
    expect(adVisible({ company: { ...live, suspendedAt: now }, ad }, now)).toBe(false);
    expect(adVisible({ company: live, ad: { ...ad, status: "DRAFT" } }, now)).toBe(false);
  });
});
