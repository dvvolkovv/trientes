import { describe, expect, it } from "vitest";
import { buildTiles, QUEUES, queueByKey, queueOfSubject, type CaseRow } from "@/lib/cases/queues";

const T = (s: string) => new Date(s);
const NOW = T("2026-11-17T10:00:00Z");

function row(over: Partial<CaseRow> = {}): CaseRow {
  return {
    subjectType: "COMPANY",
    status: "IN_REVIEW",
    openedAt: T("2026-11-16T10:00:00Z"),
    dueAt: T("2026-11-23T10:00:00Z"),
    slaSeconds: 7 * 24 * 3600,
    clockStoppedAt: null,
    ...over,
  };
}

describe("реестр очередей", () => {
  it("у каждого типа заявки есть очередь", () => {
    const types = [
      "COIN_CARD",
      "COMPANY",
      "POINT",
      "EXCHANGE",
      "FINTECH",
      "KYB",
      "COIN_REQUEST",
      "POINT_REPORT",
    ] as const;
    for (const t of types) expect(queueOfSubject(t)).toBeTruthy();
  });

  it("ключи очередей не повторяются", () => {
    const keys = QUEUES.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("неизвестный ключ очереди — null, а не падение", () => {
    expect(queueByKey("нет-такой")).toBeNull();
  });
});

describe("сборка плиток", () => {
  it("считает только открытые дела", () => {
    const tiles = buildTiles([row(), row({ status: "APPROVED" }), row({ status: "REJECTED" })], NOW);
    expect(tiles.find((t) => t.key === "companies")!.open).toBe(1);
  });

  it("показывает возраст самой старой заявки", () => {
    const tiles = buildTiles(
      [row({ openedAt: T("2026-11-16T10:00:00Z") }), row({ openedAt: T("2026-11-10T10:00:00Z") })],
      NOW,
    );
    expect(tiles.find((t) => t.key === "companies")!.oldestOpenedAt!.toISOString()).toBe(
      "2026-11-10T10:00:00.000Z",
    );
  });

  it("берёт худшее состояние срока по очереди", () => {
    const tiles = buildTiles([row(), row({ dueAt: T("2026-11-16T10:00:00Z") })], NOW);
    expect(tiles.find((t) => t.key === "companies")!.worst).toBe("late");
  });

  it("дела одной очереди не попадают в чужую плитку", () => {
    const tiles = buildTiles([row({ subjectType: "POINT" })], NOW);
    expect(tiles.find((t) => t.key === "points")!.open).toBe(1);
    expect(tiles.find((t) => t.key === "companies")!.open).toBe(0);
  });

  it("пустая очередь остаётся в списке с нулём", () => {
    const tiles = buildTiles([], NOW);
    expect(tiles).toHaveLength(QUEUES.length);
    expect(tiles.every((t) => t.open === 0 && t.worst === null)).toBe(true);
  });
});
