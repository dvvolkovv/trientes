import { describe, it, expect } from "vitest";
import { STAFF_PRESETS, presetGrants } from "@/lib/staff/presets";
import { QUEUES } from "@/lib/cases/queues";

describe("готовые должности", () => {
  it("каждая должность высказывается о каждой очереди", () => {
    for (const p of STAFF_PRESETS) {
      const grants = presetGrants(p.key);
      for (const q of QUEUES) {
        expect(Object.prototype.hasOwnProperty.call(grants, q.key)).toBe(true);
      }
    }
  });

  it("только чтение не даёт ничего, кроме чтения", () => {
    expect(new Set(Object.values(presetGrants("readOnly")))).toEqual(new Set(["VIEW"]));
  });

  it("старший утверждает во всех очередях", () => {
    expect(new Set(Object.values(presetGrants("senior")))).toEqual(new Set(["APPROVE"]));
  });

  it("проверяющий ведёт дела, но не утверждает нигде", () => {
    const grants = presetGrants("reviewer");
    expect(Object.values(grants)).not.toContain("APPROVE");
    expect(grants.coinCards).toBe("HANDLE");
  });

  it("офицер KYB утверждает только в своих двух очередях", () => {
    const grants = presetGrants("kybOfficer");
    expect(grants.kyb).toBe("APPROVE");
    expect(grants.companies).toBe("APPROVE");
    expect(grants.coinCards).toBe("VIEW");
  });
});
