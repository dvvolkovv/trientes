import { describe, expect, it } from "vitest";
import { normalizeProductReportInput } from "@/lib/products/reports";

describe("normalizeProductReportInput", () => {
  it("takes a known reason and keeps the comment", () => {
    expect(normalizeProductReportInput({ productId: "p1", reason: "FAKE", comment: " подделка " })).toEqual({
      ok: true,
      productId: "p1",
      reason: "FAKE",
      comment: "подделка",
    });
  });

  it("asks for words where the reason alone says nothing", () => {
    // «Неверные данные» без указания, какие именно, — пустая строка в очереди.
    expect(normalizeProductReportInput({ productId: "p1", reason: "WRONG_DATA" })).toEqual({
      ok: false,
      reason: "comment_required",
    });
    expect(normalizeProductReportInput({ productId: "p1", reason: "OTHER", comment: "   " })).toEqual({
      ok: false,
      reason: "comment_required",
    });
  });

  it("needs no words where the reason speaks for itself", () => {
    expect(normalizeProductReportInput({ productId: "p1", reason: "ILLEGAL" }).ok).toBe(true);
  });

  it("refuses an unknown reason and a missing product", () => {
    expect(normalizeProductReportInput({ productId: "p1", reason: "BECAUSE" })).toEqual({ ok: false, reason: "bad_reason" });
    expect(normalizeProductReportInput({ reason: "FAKE" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a comment longer than the column", () => {
    expect(normalizeProductReportInput({ productId: "p1", reason: "FAKE", comment: "x".repeat(1001) })).toEqual({
      ok: false,
      reason: "comment_too_long",
    });
  });
});
