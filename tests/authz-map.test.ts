import { describe, expect, it } from "vitest";
import { ACCESS_MAP, ALL_QUEUES, requirementFor, SUBJECT_QUEUES } from "@/lib/authz/map";
import { QUEUES } from "@/lib/cases/queues";

describe("карта прав", () => {
  it("у требования уровня есть хотя бы одна настоящая очередь", () => {
    for (const row of ACCESS_MAP) {
      if (row.need === "owner" || row.need === "staff") {
        expect(row.queues).toEqual([]);
        continue;
      }
      expect(row.queues.length).toBeGreaterThan(0);
      for (const q of row.queues) {
        expect(QUEUES.some((x) => x.key === q)).toBe(true);
      }
    }
  });

  it("ключи не повторяются", () => {
    const keys = ACCESS_MAP.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("реестр очередей и список карты — одно и то же", () => {
    expect(ALL_QUEUES).toEqual(QUEUES.map((q) => q.key));
  });

  it("у каждого типа дела есть очередь, и она настоящая", () => {
    for (const queues of Object.values(SUBJECT_QUEUES)) {
      expect(queues.length).toBeGreaterThan(0);
      for (const q of queues) expect(ALL_QUEUES).toContain(q);
    }
  });

  it("каждая очередь отвечает хотя бы за один тип дела", () => {
    const covered = new Set(Object.values(SUBJECT_QUEUES).flat());
    for (const q of ALL_QUEUES) expect(covered.has(q)).toBe(true);
  });

  it("дело жалобы вправе вести и по точкам, и по жалобам", () => {
    expect(SUBJECT_QUEUES.POINT_REPORT).toEqual(["points", "pointReports"]);
  });

  it("решение по делу требует APPROVE, подпись «проверил» — HANDLE", () => {
    expect(requirementFor("decideCase")?.need).toBe("APPROVE");
    expect(requirementFor("markReviewed")?.need).toBe("HANDLE");
  });

  it("экраны управления системой — только владельцу", () => {
    for (const key of ["adminUsers", "adminAudit", "adminAnalytics", "adminCoins", "adminStaff"]) {
      expect(requirementFor(key)?.need).toBe("owner");
    }
  });

  it("неизвестный ключ — null, а не догадка", () => {
    expect(requirementFor("нет такого")).toBe(null);
  });
});

describe("закрытие спама", () => {
  it("требует права утверждать", () => {
    expect(requirementFor("closeCasesAsSpam")?.need).toBe("APPROVE");
  });
});
