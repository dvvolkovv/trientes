import { describe, expect, it, vi } from "vitest";
import { approveRequestCore } from "@/lib/admin/approve-request";
import { setUserRoleCore } from "@/lib/admin/set-user-role";

function makeFakePrisma() {
  const requests: Record<string, {
    id: string; userId: string; name: string; symbol: string; coingeckoId: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED"; reviewedById: string | null; reviewedAt: Date | null; rejectReason: string | null;
  }> = {};
  const coins: Record<string, {
    id: string; symbol: string; name: string; slug: string; rank: number; source: string;
    addedByAdminId: string | null; approvedFromRequestId: string | null; isActive: boolean;
  }> = {};
  const users: Record<string, { id: string; role: "USER" | "ADMIN" }> = {};

  return {
    state: { requests, coins, users },
    prisma: {
      coinRequest: {
        findUnique: vi.fn(async ({ where }: any) => requests[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          requests[where.id] = { ...requests[where.id], ...data };
          return requests[where.id];
        }),
      },
      coin: {
        findUnique: vi.fn(async ({ where }: any) => coins[where.id] ?? null),
        create: vi.fn(async ({ data }: any) => {
          coins[data.id] = data;
          return data;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          coins[where.id] = { ...coins[where.id], ...data };
          return coins[where.id];
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          users[where.id] = { ...users[where.id], ...data };
          return users[where.id];
        }),
        count: vi.fn(async ({ where }: any) => {
          if (where.role === "ADMIN") return Object.values(users).filter((u) => u.role === "ADMIN").length;
          return Object.keys(users).length;
        }),
      },
    },
  };
}

describe("approveRequestCore", () => {
  it("creates Coin and marks request APPROVED", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r1"] = {
      id: "r1", userId: "user1", name: "Foo Chain", symbol: "FOO",
      coingeckoId: "foo-chain", status: "PENDING",
      reviewedById: null, reviewedAt: null, rejectReason: null,
    };

    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r1",
      reviewerId: "admin1",
      coingeckoIdOverride: undefined,
    });

    expect(res).toMatchObject({ ok: true, coinId: "foo-chain" });
    expect(fake.state.coins["foo-chain"]).toMatchObject({
      id: "foo-chain", symbol: "FOO", name: "Foo Chain",
      source: "ADMIN_ADDED", addedByAdminId: "admin1",
      approvedFromRequestId: "r1", isActive: true,
    });
    expect(fake.state.requests["r1"].status).toBe("APPROVED");
    expect(fake.state.requests["r1"].reviewedById).toBe("admin1");
  });

  it("uses coingeckoIdOverride when provided", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r2"] = {
      id: "r2", userId: "u", name: "Bar", symbol: "BAR",
      coingeckoId: null, status: "PENDING",
      reviewedById: null, reviewedAt: null, rejectReason: null,
    };

    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r2", reviewerId: "admin1", coingeckoIdOverride: "bar-correct-id",
    });

    expect(res).toMatchObject({ ok: true, coinId: "bar-correct-id" });
    expect(fake.state.coins["bar-correct-id"]).toBeDefined();
  });

  it("returns no_coingecko_id when neither request nor override has one", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r3"] = {
      id: "r3", userId: "u", name: "X", symbol: "X", coingeckoId: null,
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r3", reviewerId: "a", coingeckoIdOverride: "",
    });
    expect(res).toEqual({ ok: false, reason: "no_coingecko_id" });
  });

  it("returns not_pending when request already processed", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r4"] = {
      id: "r4", userId: "u", name: "Y", symbol: "Y", coingeckoId: "y",
      status: "APPROVED", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "r4", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "not_pending" });
  });

  it("returns not_found when request id unknown", async () => {
    const fake = makeFakePrisma();
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "rnope", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns coin_exists when the target id is already a known coin", async () => {
    const fake = makeFakePrisma();
    fake.state.coins["bitcoin"] = {
      id: "bitcoin", symbol: "BTC", name: "Bitcoin", slug: "bitcoin",
      rank: 1, source: "AUTO_L1", addedByAdminId: null,
      approvedFromRequestId: null, isActive: true,
    };
    fake.state.requests["r5"] = {
      id: "r5", userId: "u", name: "Bitcoin", symbol: "BTC", coingeckoId: "bitcoin",
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "r5", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "coin_exists" });
  });

  it("normalises coingeckoIdOverride to lowercase, trims whitespace", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r6"] = {
      id: "r6", userId: "u", name: "Q", symbol: "Q", coingeckoId: null,
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r6", reviewerId: "a", coingeckoIdOverride: "  My-Coin  ",
    });
    expect(res).toMatchObject({ ok: true, coinId: "my-coin" });
  });
});

describe("setUserRoleCore", () => {
  it("promotes USER to ADMIN", async () => {
    const fake = makeFakePrisma();
    fake.state.users["u1"] = { id: "u1", role: "USER" };
    fake.state.users["admin1"] = { id: "admin1", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "u1", role: "ADMIN", actorId: "admin1",
    });
    expect(res).toEqual({ ok: true });
    expect(fake.state.users["u1"].role).toBe("ADMIN");
  });

  it("demotes ADMIN to USER", async () => {
    const fake = makeFakePrisma();
    fake.state.users["a1"] = { id: "a1", role: "ADMIN" };
    fake.state.users["a2"] = { id: "a2", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "a1", role: "USER", actorId: "a2",
    });
    expect(res).toEqual({ ok: true });
    expect(fake.state.users["a1"].role).toBe("USER");
  });

  it("refuses to demote the last admin", async () => {
    const fake = makeFakePrisma();
    fake.state.users["only-admin"] = { id: "only-admin", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "only-admin", role: "USER", actorId: "only-admin",
    });
    expect(res).toEqual({ ok: false, reason: "last_admin" });
    expect(fake.state.users["only-admin"].role).toBe("ADMIN");
  });

  it("returns not_found for unknown user", async () => {
    const fake = makeFakePrisma();
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "nope", role: "ADMIN", actorId: "a",
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
