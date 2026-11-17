import { describe, expect, it } from "vitest";
import { buildTiles, QUEUES, queueByKey, queueOfSubject, type CaseRow } from "@/lib/cases/queues";

const T = (s: string) => new Date(s);
const NOW = T("2026-11-17T10:00:00Z");

function row(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: "c1",
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

describe("buildTiles — непрочитанное", () => {
  const row = (subjectType: "COIN_CARD" | "POINT", id: string) => ({
    id,
    subjectType,
    status: "IN_REVIEW" as const,
    openedAt: new Date("2026-11-10T10:00:00Z"),
    dueAt: new Date("2026-11-20T10:00:00Z"),
    slaSeconds: 864000,
    clockStoppedAt: null,
  });

  it("складывает непрочитанное по делам очереди", () => {
    const tiles = buildTiles(
      [row("COIN_CARD", "a"), row("COIN_CARD", "b"), row("POINT", "c")],
      new Date("2026-11-17T10:00:00Z"),
      new Map([
        ["a", 2],
        ["c", 1],
      ]),
    );
    expect(tiles.find((t) => t.key === "coinCards")!.unread).toBe(2);
    expect(tiles.find((t) => t.key === "points")!.unread).toBe(1);
    expect(tiles.find((t) => t.key === "companies")!.unread).toBe(0);
  });

  it("без карты непрочитанного плитка просто молчит", () => {
    const tiles = buildTiles([row("COIN_CARD", "a")], new Date("2026-11-17T10:00:00Z"));
    expect(tiles.find((t) => t.key === "coinCards")!.unread).toBe(0);
  });
});
