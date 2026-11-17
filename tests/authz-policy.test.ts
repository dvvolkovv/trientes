import { describe, expect, it } from "vitest";
import {
  can,
  canAny,
  canOwnerOnly,
  isOwnerRole,
  isStaffRole,
  levelFor,
  visibleQueues,
  type ViewerAccess,
} from "@/lib/authz/policy";

const NOW = new Date("2026-11-18T10:00:00Z");

function access(p: Partial<ViewerAccess> = {}): ViewerAccess {
  return { userId: "u1", role: "STAFF", revokedAt: null, grants: [], ...p };
}

describe("уровни доступа", () => {
  it("APPROVE включает HANDLE и VIEW", () => {
    const a = access({ grants: [{ queue: "coinCards", level: "APPROVE", expiresAt: null }] });
    expect(can(a, "coinCards", "VIEW", NOW)).toBe(true);
    expect(can(a, "coinCards", "HANDLE", NOW)).toBe(true);
    expect(can(a, "coinCards", "APPROVE", NOW)).toBe(true);
  });

  it("HANDLE не даёт права утверждать", () => {
    const a = access({ grants: [{ queue: "coinCards", level: "HANDLE", expiresAt: null }] });
    expect(can(a, "coinCards", "APPROVE", NOW)).toBe(false);
    expect(can(a, "coinCards", "HANDLE", NOW)).toBe(true);
  });

  it("нет строки — нет доступа", () => {
    expect(can(access(), "coinCards", "VIEW", NOW)).toBe(false);
    expect(levelFor(access(), "coinCards", NOW)).toBe(null);
  });

  it("право одной очереди не работает в другой", () => {
    const a = access({ grants: [{ queue: "coinCards", level: "APPROVE", expiresAt: null }] });
    expect(can(a, "exchanges", "VIEW", NOW)).toBe(false);
  });

  it("истёкший срок гасит право", () => {
    const a = access({
      grants: [{ queue: "kyb", level: "APPROVE", expiresAt: new Date("2026-11-17T00:00:00Z") }],
    });
    expect(levelFor(a, "kyb", NOW)).toBe(null);
  });

  it("срок в будущем право не трогает", () => {
    const a = access({
      grants: [{ queue: "kyb", level: "HANDLE", expiresAt: new Date("2026-12-01T00:00:00Z") }],
    });
    expect(levelFor(a, "kyb", NOW)).toBe("HANDLE");
  });

  it("владелец может всё и видит все восемь очередей", () => {
    const a = access({ role: "OWNER" });
    expect(can(a, "fintech", "APPROVE", NOW)).toBe(true);
    expect(visibleQueues(a, NOW)).toHaveLength(8);
    expect(canOwnerOnly(a)).toBe(true);
  });

  it("ADMIN читается как владелец — наследие", () => {
    expect(isOwnerRole("ADMIN")).toBe(true);
    expect(can(access({ role: "ADMIN" }), "points", "APPROVE", NOW)).toBe(true);
  });

  it("посетитель не сотрудник и грантами не спасается", () => {
    const a = access({
      role: "USER",
      grants: [{ queue: "points", level: "APPROVE", expiresAt: null }],
    });
    expect(isStaffRole("USER")).toBe(false);
    expect(can(a, "points", "VIEW", NOW)).toBe(false);
  });

  it("отозванный доступ не действует даже с грантами", () => {
    const a = access({
      revokedAt: new Date("2026-11-17T00:00:00Z"),
      grants: [{ queue: "points", level: "APPROVE", expiresAt: null }],
    });
    expect(can(a, "points", "VIEW", NOW)).toBe(false);
    expect(visibleQueues(a, NOW)).toEqual([]);
  });

  it("отозванный владелец тоже не владелец", () => {
    expect(canOwnerOnly(access({ role: "OWNER", revokedAt: NOW }))).toBe(false);
  });

  it("видимые очереди — только выданные, в порядке реестра", () => {
    const a = access({
      grants: [
        { queue: "exchanges", level: "VIEW", expiresAt: null },
        { queue: "coinCards", level: "HANDLE", expiresAt: null },
      ],
    });
    expect(visibleQueues(a, NOW)).toEqual(["coinCards", "exchanges"]);
  });

  it("canAny: хватает права в одной из очередей объекта", () => {
    const a = access({ grants: [{ queue: "pointReports", level: "APPROVE", expiresAt: null }] });
    expect(canAny(a, ["points", "pointReports"], "APPROVE", NOW)).toBe(true);
    expect(canAny(a, ["points"], "APPROVE", NOW)).toBe(false);
  });
});
