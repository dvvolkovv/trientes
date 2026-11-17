import { describe, expect, it } from "vitest";
import { planReview, reviewAction, reviewAddressee } from "@/lib/cases/company-review-sweep";

const now = new Date("2026-11-17T00:00:00Z");

describe("план пересмотра", () => {
  it("пустая дата наверстывается молча от даты одобрения", () => {
    const step = planReview(
      { nextReviewAt: null, risk: "MEDIUM", listedAt: new Date("2026-01-10T00:00:00Z") },
      now,
    );
    expect(step.setNextReviewAt?.toISOString()).toBe("2027-01-10T00:00:00.000Z");
    expect(step.ring).toBe(false);
  });

  it("наверстанная дата уже близко — звоним сразу", () => {
    const step = planReview(
      { nextReviewAt: null, risk: "MEDIUM", listedAt: new Date("2025-01-10T00:00:00Z") },
      now,
    );
    expect(step.setNextReviewAt?.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(step.ring).toBe(true);
  });

  it("листинга не видно — наверстывать не от чего", () => {
    const step = planReview({ nextReviewAt: null, risk: "MEDIUM", listedAt: null }, now);
    expect(step.setNextReviewAt).toBe(null);
    expect(step.ring).toBe(false);
  });

  it("за 30 дней звоним, за 60 — нет", () => {
    expect(
      planReview(
        { nextReviewAt: new Date("2026-12-05T00:00:00Z"), risk: "MEDIUM", listedAt: null },
        now,
      ).ring,
    ).toBe(true);
    expect(
      planReview(
        { nextReviewAt: new Date("2027-02-05T00:00:00Z"), risk: "MEDIUM", listedAt: null },
        now,
      ).ring,
    ).toBe(false);
  });

  it("высокий риск пересматривается вдвое чаще", () => {
    const step = planReview(
      { nextReviewAt: null, risk: "HIGH", listedAt: new Date("2026-06-01T00:00:00Z") },
      now,
    );
    expect(step.setNextReviewAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(step.ring).toBe(true);
  });
});

describe("адресат звонка", () => {
  it("проверявший, иначе взявший, иначе утвердивший", () => {
    expect(reviewAddressee({ reviewedById: "a", assigneeId: "b", approvedById: "c" })).toBe("a");
    expect(reviewAddressee({ reviewedById: null, assigneeId: "b", approvedById: "c" })).toBe("b");
    expect(reviewAddressee({ reviewedById: null, assigneeId: null, approvedById: "c" })).toBe("c");
    // Некому звонить — молчим: безадресный звонок будит всех админов.
    expect(reviewAddressee({ reviewedById: null, assigneeId: null, approvedById: null })).toBe(null);
  });

  it("у залистованного до слайса AN подписей дела нет — звоним одобрившему компанию", () => {
    expect(
      reviewAddressee({
        reviewedById: null,
        assigneeId: null,
        approvedById: null,
        companyReviewedById: "old-admin",
      }),
    ).toBe("old-admin");
    // Подпись в самом деле всё равно старше: она про эту работу.
    expect(
      reviewAddressee({
        reviewedById: "a",
        assigneeId: null,
        approvedById: null,
        companyReviewedById: "old-admin",
      }),
    ).toBe("a");
  });
});

describe("что делать в срок", () => {
  it("есть адресат — звоним", () => {
    expect(reviewAction({ addressee: "a", decision: "APPROVED", open: false })).toBe("BELL");
  });

  it("адресата нет, дело заведено наверстыванием — открываем его заново", () => {
    // Пересмотр это работа: она должна лежать в очереди, а не пропасть в логе.
    expect(reviewAction({ addressee: null, decision: null, open: false })).toBe("REOPEN");
  });

  it("решённое в самой системе заново не открываем", () => {
    // У него есть решение: повторное одобрение прошло бы мимо объекта.
    expect(reviewAction({ addressee: null, decision: "APPROVED", open: false })).toBe("NONE");
  });

  it("дело и так в очереди — не трогаем", () => {
    expect(reviewAction({ addressee: null, decision: null, open: true })).toBe("NONE");
  });
});
