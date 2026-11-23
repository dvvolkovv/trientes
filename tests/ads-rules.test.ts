import { describe, expect, it } from "vitest";
import {
  adInWindow, adTextHash, adVisible, adVoiceStale, isAdVoice, isOwnMedia, parseAdInput, type AdInput,
} from "@/lib/ads/rules";

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

  it("«показать на карте» ведёт на точку приёма или на место самого материала", () => {
    // Объект рекламы — офис, площадка, дом — точкой приёма не является. Требовать
    // выбора из точек значило бы, что у такой рекламы действия не бывает вовсе.
    expect(parseAdInput({ ...base, action: "POINT" }))
      .toMatchObject({ ok: false, reason: "point_or_place_required" });

    const onPoint = parseAdInput({ ...base, action: "POINT", pointId: "cmwpoint1" });
    expect(onPoint.ok).toBe(true);
    if (onPoint.ok) expect(onPoint.value.pointId).toBe("cmwpoint1");

    const onPlace = parseAdInput({
      ...base, action: "POINT",
      placeName: "LMNT Offices", placeAddress: "Bahnhofplatz 10, 9100 Herisau",
      placeLat: 47.3900641, placeLon: 9.2773337,
    });
    expect(onPlace.ok).toBe(true);
    if (onPlace.ok) {
      expect(onPlace.value.pointId).toBeNull();
      expect(onPlace.value.placeLat).toBeCloseTo(47.3900641, 6);
    }
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

describe("рекламный материал: место и конец события (слайс BZ)", () => {
  it("конец события раньше начала отвергает", () => {
    expect(parseAdInput({ ...base, kind: "EVENT", eventAt: "2026-12-10", eventEndAt: "2026-12-01" }))
      .toMatchObject({ ok: false, reason: "event_backwards" });
    expect(parseAdInput({ ...base, kind: "EVENT", eventAt: "2026-12-01", eventEndAt: "2026-12-03" }).ok).toBe(true);
  });

  it("конец без начала — не срок события", () => {
    expect(parseAdInput({ ...base, eventEndAt: "2026-12-03" }))
      .toMatchObject({ ok: false, reason: "event_required" });
  });

  it("событие одного дня: конец равен началу — это законно", () => {
    expect(parseAdInput({ ...base, kind: "EVENT", eventAt: "2026-12-01", eventEndAt: "2026-12-01" }).ok).toBe(true);
  });

  it("место без координат не принимает: «где-то» местом не является", () => {
    expect(parseAdInput({ ...base, placeName: "LMNT Offices" }))
      .toMatchObject({ ok: false, reason: "place_coords_required" });
  });

  it("место с булавкой принимает и чистит набор монет и способов оплаты", () => {
    const r = parseAdInput({
      ...base,
      placeName: " LMNT Offices ",
      placeAddress: " Bahnhofplatz 10 ",
      placeLat: 47.39,
      placeLon: 9.277,
      placeAcceptedCoinIds: ["bitcoin", "bitcoin", "  ", "ethereum"],
      placePaymentMethods: ["cash", "pigeon", "card"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.placeName).toBe("LMNT Offices");
    expect(r.value.placeAddress).toBe("Bahnhofplatz 10");
    expect(r.value.placeAcceptedCoinIds).toEqual(["bitcoin", "ethereum"]);
    // Неизвестный способ оплаты выбрасывается, порядок — реестра (BY).
    expect(r.value.placePaymentMethods).toEqual(["cash", "card"]);
  });

  it("булавка за пределами земли — не булавка", () => {
    expect(parseAdInput({ ...base, placeLat: 95, placeLon: 9 }))
      .toMatchObject({ ok: false, reason: "place_coords_invalid" });
    expect(parseAdInput({ ...base, placeLat: 0, placeLon: 0 }))
      .toMatchObject({ ok: false, reason: "place_coords_invalid" });
  });

  it("монеты и оплата без места не сохраняются: обещание без адреса", () => {
    const r = parseAdInput({ ...base, placeAcceptedCoinIds: ["bitcoin"], placePaymentMethods: ["cash"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.placeAcceptedCoinIds).toEqual([]);
    expect(r.value.placePaymentMethods).toEqual([]);
  });

  it("ссылку в названии места отвергает, как и в тексте", () => {
    expect(parseAdInput({ ...base, placeName: "arcon.ch office", placeLat: 47.39, placeLon: 9.277 }))
      .toMatchObject({ ok: false, reason: "text_has_link" });
  });
});

describe("озвучка материала (слайс BZ)", () => {
  it("отпечаток текста меняется вместе с текстом и не зависит от пробелов по краям", () => {
    expect(adTextHash("Заголовок", "Текст")).toBe(adTextHash(" Заголовок ", "Текст "));
    expect(adTextHash("Заголовок", "Текст")).not.toBe(adTextHash("Заголовок", "Другой"));
  });

  it("устаревшей считается запись нашего синтеза, сделанная по прежнему тексту", () => {
    const hash = adTextHash("A", "B");
    expect(adVoiceStale({ audioUrl: "/u.mp3", audioGenerated: true, audioTextHash: hash }, "A", "B")).toBe(false);
    expect(adVoiceStale({ audioUrl: "/u.mp3", audioGenerated: true, audioTextHash: hash }, "A", "C")).toBe(true);
    // Присланная продавцом запись нашим текстом не мерится: это его голос.
    expect(adVoiceStale({ audioUrl: "/u.mp3", audioGenerated: false, audioTextHash: null }, "A", "C")).toBe(false);
    expect(adVoiceStale({ audioUrl: null, audioGenerated: false, audioTextHash: null }, "A", "C")).toBe(false);
  });

  it("голос синтеза — только из реестра", () => {
    expect(isAdVoice("alloy")).toBe(true);
    expect(isAdVoice("шептун")).toBe(false);
  });
});
