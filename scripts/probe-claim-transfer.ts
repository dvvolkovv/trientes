// Разовая живая проверка передачи владения: временная карточка, куратор и
// заявитель, настоящая транзакция в базе, затем всё удаляется.
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "../src/lib/prisma";
import { transferCardOwnership } from "../src/lib/coin-card-claim-transfer";
import { claimToken, CLAIM_TTL_MS } from "../src/lib/coin-card-claim";

async function main() {
  const stamp = Date.now();
  const steward = await prisma.user.create({ data: { username: `probe-steward-${stamp}` } });
  const claimant = await prisma.user.create({ data: { username: `probe-claimant-${stamp}` } });
  const card = await prisma.coinCard.create({
    data: {
      slug: `probe-claim-${stamp}`,
      name: "Claim probe",
      symbol: "PRB",
      status: "APPROVED",
      stewardUserId: steward.id,
      members: { create: [{ userId: steward.id, role: "OWNER", isSigner: true }] },
      claims: {
        create: [
          { claimantId: claimant.id, method: "DNS_TXT", token: claimToken(), expiresAt: new Date(stamp + CLAIM_TTL_MS) },
          { claimantId: steward.id, method: "WELL_KNOWN", token: claimToken(), expiresAt: new Date(stamp + CLAIM_TTL_MS) },
        ],
      },
    },
    include: { claims: true },
  });

  try {
    const target = card.claims.find((c) => c.claimantId === claimant.id)!;
    const { trust } = await transferCardOwnership(prisma as never, {
      cardId: card.id,
      claimId: target.id,
      newOwnerId: claimant.id,
      previousStewardId: steward.id,
      method: "DNS_TXT",
      target: "example.com",
      contractVerified: false,
    });

    const after = await prisma.coinCard.findUniqueOrThrow({
      where: { id: card.id },
      include: { members: { select: { userId: true, role: true, isSigner: true } }, claims: true },
    });
    console.log("trust:", trust, "→ в базе:", after.trust);
    console.log("куратор теперь:", after.stewardUserId === claimant.id ? "заявитель" : "НЕ заявитель");
    for (const m of after.members) {
      const who = m.userId === claimant.id ? "заявитель" : "прежний куратор";
      console.log(`  ${who}: ${m.role}${m.isSigner ? " (подписант)" : ""}`);
    }
    for (const c of after.claims) {
      console.log(`  заявка ${c.method}: ${c.status}`);
    }
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: card.id, action: "TRANSFER_COIN_CARD" },
      orderBy: { createdAt: "desc" },
    });
    console.log("аудит:", audit?.action, JSON.stringify(audit?.details));
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { targetId: card.id } });
    await prisma.coinCard.delete({ where: { id: card.id } });
    await prisma.user.deleteMany({ where: { id: { in: [steward.id, claimant.id] } } });
    console.log("временные данные удалены");
    await prisma.$disconnect();
  }
}
void main();
