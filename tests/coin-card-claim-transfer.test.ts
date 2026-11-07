import { describe, it, expect } from "vitest";
import { transferCardOwnership, type TransferPrismaLike } from "../src/lib/coin-card-claim-transfer";

type Call = { table: string; args: Record<string, unknown> };

function fake(): { prisma: TransferPrismaLike; calls: Call[]; ops: unknown[] } {
  const calls: Call[] = [];
  const ops: unknown[] = [];
  const op = (table: string) => (args: unknown) => {
    const call = { table, args: args as Record<string, unknown> };
    calls.push(call);
    return call;
  };
  const prisma: TransferPrismaLike = {
    coinCardMember: { upsert: op("member.upsert"), updateMany: op("member.updateMany") },
    coinCard: { update: op("card.update") },
    coinCardClaim: { updateMany: op("claim.updateMany") },
    adminAuditLog: { create: op("audit.create") },
    $transaction: async (list) => { ops.push(...list); return list; },
  };
  return { prisma, calls, ops };
}

const base = {
  cardId: "c1",
  claimId: "cl1",
  newOwnerId: "u-new",
  previousStewardId: "u-old",
  method: "DNS_TXT" as const,
  target: "example.com",
  contractVerified: false,
};

describe("transferCardOwnership", () => {
  it("делает владельцем, понижает куратора и пишет аудит одной транзакцией", async () => {
    const { prisma, calls, ops } = fake();
    const r = await transferCardOwnership(prisma, base);

    expect(r.trust).toBe("PROJECT_CLAIMED");
    expect(ops.length).toBe(5); // владелец, понижение, карточка, заявки, аудит

    const member = calls.find((c) => c.table === "member.upsert");
    expect(member?.args).toMatchObject({
      where: { cardId_userId: { cardId: "c1", userId: "u-new" } },
      create: { role: "OWNER", isSigner: true },
      update: { role: "OWNER", sections: [], isSigner: true },
    });

    const demote = calls.find((c) => c.table === "member.updateMany");
    expect(demote?.args).toMatchObject({
      where: { cardId: "c1", userId: "u-old" },
      data: { role: "EDITOR" },
    });

    const card = calls.find((c) => c.table === "card.update");
    expect(card?.args).toMatchObject({ data: { stewardUserId: "u-new", trust: "PROJECT_CLAIMED" } });

    const others = calls.find((c) => c.table === "claim.updateMany");
    expect(others?.args).toMatchObject({
      where: { cardId: "c1", status: "PENDING", id: { not: "cl1" } },
      data: { status: "CANCELLED" },
    });

    const audit = calls.find((c) => c.table === "audit.create");
    expect(audit?.args).toMatchObject({
      data: {
        actorId: "u-new",
        action: "TRANSFER_COIN_CARD",
        targetId: "c1",
        details: { method: "DNS_TXT", target: "example.com", claim: true },
      },
    });
  });

  it("сверенный контракт поднимает доверие сразу до FULLY_VERIFIED", async () => {
    const { prisma, calls } = fake();
    const r = await transferCardOwnership(prisma, { ...base, contractVerified: true });
    expect(r.trust).toBe("FULLY_VERIFIED");
    expect(calls.find((c) => c.table === "card.update")?.args).toMatchObject({
      data: { trust: "FULLY_VERIFIED" },
    });
  });

  it("куратор, он же заявитель, не понижается сам себя", async () => {
    const { prisma, calls, ops } = fake();
    await transferCardOwnership(prisma, { ...base, previousStewardId: "u-new" });
    expect(calls.some((c) => c.table === "member.updateMany")).toBe(false);
    expect(ops.length).toBe(4);
  });

  it("карточка без куратора переходит без понижения", async () => {
    const { prisma, calls } = fake();
    await transferCardOwnership(prisma, { ...base, previousStewardId: null });
    expect(calls.some((c) => c.table === "member.updateMany")).toBe(false);
  });
});
