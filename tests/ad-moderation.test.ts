import { describe, expect, it } from "vitest";
import {
  adDiff,
  adEditMode,
  adSlotsFree,
  adSlotsTaken,
  adSubmittable,
  adWithdrawable,
  readPendingPayload,
  type AdStatus,
} from "@/lib/ads/moderation";
import { MAX_CAROUSEL_SLIDES } from "@/lib/ads/rules";
import { CHECKLISTS } from "@/lib/cases/checklists";
import { SLA_BUSINESS_DAYS } from "@/lib/cases/sla";
import { SUBJECT_QUEUES } from "@/lib/authz/map";
import { queueOfSubject } from "@/lib/cases/queues";

/**
 * Модерация рекламы (слайс CC). Правила живут отдельно от Prisma ровно затем,
 * чтобы их держал тест, а не живое нажатие в кабинете.
 */

const MEDIA = "/uploads/ads/cmwtest000000000000000000/0123456789abcdef0123456789abcdef.png";

function input(patch: Record<string, unknown> = {}) {
  return {
    kind: "PROMO", title: "Кофе всю неделю", body: "Вторая чашка в подарок.",
    language: "ru", mediaKind: "IMAGE", mediaUrl: MEDIA, action: "NONE",
    ...patch,
  } as never;
}

describe("дорога материала", () => {
  it("правится в колонках, пока материал не был опубликован", () => {
    expect(adEditMode("DRAFT")).toBe("direct");
    expect(adEditMode("REJECTED")).toBe("direct");
    expect(adEditMode("ARCHIVED")).toBe("direct");
  });

  it("на проверке не правится вовсе: модератор смотрит именно это содержание", () => {
    expect(adEditMode("PENDING")).toBe("frozen");
  });

  it("правка опубликованного ложится слепком, а в карусели остаётся одобренное", () => {
    expect(adEditMode("PUBLISHED")).toBe("proposal");
  });

  it("отправить на проверку можно черновик, отвергнутое и архивное", () => {
    expect(adSubmittable("DRAFT")).toBe(true);
    expect(adSubmittable("REJECTED")).toBe(true);
    // Архив идёт через проверку заново: «когда-то одобрено» не значит «одобрено сейчас».
    expect(adSubmittable("ARCHIVED")).toBe(true);
    expect(adSubmittable("PENDING")).toBe(false);
    expect(adSubmittable("PUBLISHED")).toBe(false);
  });

  it("отозвать можно материал на проверке и ждущую правку опубликованного", () => {
    expect(adWithdrawable({ status: "PENDING", hasPending: false })).toBe(true);
    expect(adWithdrawable({ status: "PUBLISHED", hasPending: true })).toBe(true);
    expect(adWithdrawable({ status: "PUBLISHED", hasPending: false })).toBe(false);
    expect(adWithdrawable({ status: "DRAFT", hasPending: false })).toBe(false);
  });
});

describe("места в карусели", () => {
  const one = { mediaKind: "IMAGE", mediaUrl: MEDIA, posterUrl: null };
  const rows = (...statuses: AdStatus[]) => statuses.map((status) => ({ status, ...one }));

  it("занимают и опубликованные, и ждущие проверки", () => {
    // Иначе потолок вскрылся бы в момент одобрения — отказом по делу, которое
    // проверяющий уже проверил.
    expect(adSlotsTaken(rows("PUBLISHED", "PENDING", "DRAFT", "ARCHIVED", "REJECTED"))).toBe(2);
  });

  it("черновик, архив и отказ места не держат", () => {
    expect(adSlotsTaken(rows("DRAFT", "ARCHIVED", "REJECTED"))).toBe(0);
    expect(adSlotsFree(rows("PUBLISHED"))).toBe(MAX_CAROUSEL_SLIDES - 1);
  });

  it("считаются кадры, а не материалы (слайс CE)", () => {
    // Просьба владельца буквально: один материал на восемь кадров занимает карусель
    // целиком. Считай материалы — и у числа «восемь» стало бы два смысла.
    const four = {
      status: "PUBLISHED" as AdStatus,
      ...one,
      slides: [
        { kind: "IMAGE", url: MEDIA },
        { kind: "IMAGE", url: MEDIA.replace("0123", "1123") },
        { kind: "IMAGE", url: MEDIA.replace("0123", "2123") },
        { kind: "VIDEO", url: MEDIA.replace("0123", "3123").replace(".png", ".mp4") },
      ],
    };
    expect(adSlotsTaken([four])).toBe(4);
    expect(adSlotsFree([four])).toBe(MAX_CAROUSEL_SLIDES - 4);
    // Материал, заведённый до слайса, несёт один кадр из обложки — бэкфилла не было.
    expect(adSlotsTaken([{ status: "PUBLISHED", ...one }])).toBe(1);
  });
});

describe("слепок правки", () => {
  it("проходит ту же проверку, что живая форма", () => {
    expect(readPendingPayload(input())?.title).toBe("Кофе всю неделю");
    // Правило добавили после сохранения слепка — применять его нельзя.
    expect(readPendingPayload(input({ title: "Заходите на example.org" }))).toBeNull();
    expect(readPendingPayload(input({ mediaUrl: "https://evil.example/pic.png" }))).toBeNull();
    expect(readPendingPayload(null)).toBeNull();
    expect(readPendingPayload("нет")).toBeNull();
  });

  it("показывает только различия", () => {
    const live = readPendingPayload(input())!;
    const proposed = readPendingPayload(input({ title: "Чай всю неделю", promoCode: "TEA" }))!;
    const diff = adDiff(live as unknown as Record<string, unknown>, proposed as unknown as Record<string, unknown>);
    expect(diff.map((d) => d.field).sort()).toEqual(["promoCode", "title"]);
    expect(diff.find((d) => d.field === "title")).toMatchObject({
      from: "Кофе всю неделю",
      to: "Чай всю неделю",
    });
    // Одинаковое в разговор о различиях не идёт.
    expect(adDiff(live as never, live as never)).toEqual([]);
  });
});

describe("дело материала", () => {
  it("лежит в своей очереди, а не внутри предприятий", () => {
    expect(SUBJECT_QUEUES.COMPANY_AD).toEqual(["ads"]);
    expect(queueOfSubject("COMPANY_AD")?.key).toBe("ads");
  });

  it("у листа проверок есть обязательные пункты и свой срок", () => {
    const list = CHECKLISTS.COMPANY_AD;
    expect(list.filter((c) => c.required).map((c) => c.key)).toEqual([
      "mediaRightsOk", "noMisleadingClaims", "contentAllowed",
    ]);
    // Кампания живёт неделю: пятидневный срок означал бы, что реклама не выходит.
    expect(SLA_BUSINESS_DAYS.COMPANY_AD).toBe(2);
  });
});
