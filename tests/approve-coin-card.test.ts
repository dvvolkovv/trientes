import { describe, expect, it } from "vitest";
import { approveCoinCardCore, rejectCoinCardCore } from "@/lib/admin/approve-coin-card";

type Row = {
  id: string; slug: string; name: string; symbol: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  completeness: number; logoUrl: string | null;
};

function fakeDb(card: Row | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    prisma: {
      coinCard: {
        findUnique: async () => card,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { ...(card as Row), ...data } as Row;
        },
      },
    },
  };
}

const CARD: Row = {
  id: "c1", slug: "foobar-chain", name: "Foobar Chain", symbol: "FOO",
  status: "PENDING", completeness: 55, logoUrl: "/uploads/coin-cards/c1/a.png",
};

describe("approveCoinCardCore", () => {
  it("approves a pending card and records the reviewer", async () => {
    const { prisma, updates } = fakeDb(CARD);
    const r = await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" });
    expect(r).toEqual({ ok: true, slug: "foobar-chain" });
    expect(updates[0]).toMatchObject({ status: "APPROVED", reviewedById: "admin" });
    expect(updates[0].reviewedAt).toBeInstanceOf(Date);
  });

  it("refuses a missing card", async () => {
    const { prisma } = fakeDb(null);
    expect(await approveCoinCardCore(prisma, { cardId: "nope", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a card that is not pending", async () => {
    const { prisma } = fakeDb({ ...CARD, status: "APPROVED" });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "not_pending" });
  });

  it("refuses a card below the minimum completeness", async () => {
    const { prisma } = fakeDb({ ...CARD, completeness: 10 });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "too_incomplete" });
  });

  it("refuses a card with no logo", async () => {
    const { prisma } = fakeDb({ ...CARD, logoUrl: null });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "logo_required" });
  });
});

describe("rejectCoinCardCore", () => {
  it("rejects with a reason", async () => {
    const { prisma, updates } = fakeDb(CARD);
    const r = await rejectCoinCardCore(prisma, {
      cardId: "c1", reviewerId: "admin", reason: "No contract proof",
    });
    expect(r).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({
      status: "REJECTED", rejectReason: "No contract proof", reviewedById: "admin",
    });
  });

  it("requires a reason of at least 3 chars", async () => {
    const { prisma } = fakeDb(CARD);
    expect(await rejectCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin", reason: "no" }))
      .toEqual({ ok: false, reason: "reason_too_short" });
  });

  it("refuses a card that is not pending", async () => {
    const { prisma } = fakeDb({ ...CARD, status: "REJECTED" });
    expect(await rejectCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin", reason: "spam" }))
      .toEqual({ ok: false, reason: "not_pending" });
  });
});
