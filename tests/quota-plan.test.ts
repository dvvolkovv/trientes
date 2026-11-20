import { describe, expect, it, vi } from "vitest";

import { QUOTA_SERVICES } from "@/lib/quota/budget";
import { planRun } from "@/lib/quota/plan";

const now = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));
const opts = { runsPerDay: 24, fixedCostPerRun: 1, perRunCap: 25, now };

describe("planRun", () => {
  it("считает бюджет по прочитанному расходу", async () => {
    const redis = { get: vi.fn(async () => "0"), incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) };
    const p = await planRun(redis, QUOTA_SERVICES.coinpaprika, opts);
    expect(p.allowed).toBe(true);
    expect(p.calls).toBeGreaterThan(0);
  });

  it("нет счётчика — фон не идёт: он подождёт час, а запас считается месяцем", async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error("down");
      }),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    };
    const p = await planRun(redis, QUOTA_SERVICES.coinpaprika, opts);
    expect(p.allowed).toBe(false);
    expect(p.calls).toBe(0);
    expect(p.reason).toBe("no_ledger");
  });

  it("истраченный запас останавливает фон вслух", async () => {
    const redis = {
      get: vi.fn(async (k: string) => (k.includes(":bg:") ? "9000" : "9000")),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    };
    const p = await planRun(redis, QUOTA_SERVICES.coinpaprika, opts);
    expect(p.allowed).toBe(false);
    expect(p.reason).toBe("budget_spent");
  });
});
