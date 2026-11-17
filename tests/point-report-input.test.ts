import { describe, expect, it } from "vitest";
import { normalizeReportInput } from "@/lib/points/reports";

describe("normalizeReportInput", () => {
  it("принимает известную причину", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "CLOSED" })).toEqual({
      ok: true,
      pointId: "p1",
      reason: "CLOSED",
      comment: null,
    });
  });

  it("отвергает выдуманную причину", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "BANANA" })).toEqual({
      ok: false,
      reason: "bad_reason",
    });
  });

  it("отвергает пустой id точки", () => {
    expect(normalizeReportInput({ pointId: "  ", reason: "CLOSED" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("причина OTHER без текста не принимается — иначе жалоба ничего не говорит", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "OTHER", comment: "  " })).toEqual({
      ok: false,
      reason: "comment_required",
    });
  });

  it("слишком длинный текст отвергается", () => {
    expect(
      normalizeReportInput({ pointId: "p1", reason: "CLOSED", comment: "x".repeat(1001) }),
    ).toEqual({ ok: false, reason: "comment_too_long" });
  });

  it("лишние пробелы в тексте срезаются", () => {
    expect(
      normalizeReportInput({ pointId: "p1", reason: "CLOSED", comment: "  закрыто  " }),
    ).toEqual({ ok: true, pointId: "p1", reason: "CLOSED", comment: "закрыто" });
  });
});
