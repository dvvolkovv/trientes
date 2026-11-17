import { describe, expect, it } from "vitest";
import { describeEvent } from "@/lib/cases/journal";

describe("описание события журнала", () => {
  it("взятие в работу", () => {
    expect(describeEvent({ kind: "CLAIMED", payload: null })).toEqual({ key: "claimed", params: {} });
  });

  it("смена статуса несёт оба статуса", () => {
    expect(describeEvent({ kind: "STATUS_CHANGED", payload: { from: "NEW", to: "IN_REVIEW" } })).toEqual({
      key: "statusChanged",
      params: { from: "NEW", to: "IN_REVIEW" },
    });
  });

  it("правка времени несёт минуты и причину", () => {
    expect(describeEvent({ kind: "TIME_ADJUSTED", payload: { minutes: 30, note: "созвон" } })).toEqual({
      key: "timeAdjusted",
      params: { minutes: 30, note: "созвон" },
    });
  });

  it("мусор в полезной нагрузке в параметры не идёт", () => {
    expect(describeEvent({ kind: "NOTE", payload: { ok: true, nested: { a: 1 } } })).toEqual({
      key: "note",
      params: {},
    });
  });

  it("событие без нагрузки не роняет журнал", () => {
    expect(describeEvent({ kind: "OPENED", payload: null })).toEqual({ key: "opened", params: {} });
  });
});
