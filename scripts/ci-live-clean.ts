/** Уборка живого прогона CI: всё, что завёл `ci-live-seed.ts`. */
import { prisma } from "../src/lib/prisma";

async function main() {
  // Заявку прогона узнаём по домену и по целям: адрес отправителя в прогоне
  // менялся (несуществующий ящик → наш), и ловить её по нему мало.
  const claims = await prisma.domainClaim.findMany({
    where: {
      OR: [
        { fromAddress: { contains: "ci-live" } },
        { targets: { some: { subjectName: { startsWith: "CI Live" } } } },
        { emails: { some: { messageId: { startsWith: "ci-live" } } } },
      ],
    },
    select: { id: true },
  });
  // Дела и журнал уходят каскадом за делом, заявки — за собой.
  for (const claim of claims) {
    await prisma.complianceCase.deleteMany({
      where: { subjectType: "DOMAIN_CLAIM", subjectId: claim.id },
    });
  }
  const removedClaims = await prisma.domainClaim.deleteMany({
    where: { id: { in: claims.map((c) => c.id) } },
  });

  const cards = await prisma.coinCard.findMany({
    where: { slug: "ci-live-card" },
    select: { id: true },
  });
  for (const card of cards) {
    await prisma.complianceCase.deleteMany({
      where: { subjectType: "DOMAIN_CLAIM", subjectId: card.id },
    });
  }
  const removedCards = await prisma.coinCard.deleteMany({ where: { slug: "ci-live-card" } });
  const removedFintech = await prisma.fintechCompany.deleteMany({
    where: { slug: { in: ["ci-live-fintech", "ci-live-fintech-owned"] } },
  });
  // Строки аудита держат автора: у `AdminAuditLog.actorId` стоит RESTRICT, и
  // учётка проверяющего не удалится, пока его решение лежит в журнале (на эти
  // же грабли наступила уборка AU).
  const staffIds = await prisma.user.findMany({
    where: { username: { startsWith: "ci-live" } },
    select: { id: true },
  });
  const removedAudit = await prisma.adminAuditLog.deleteMany({
    where: { actorId: { in: staffIds.map((u) => u.id) } },
  });

  const removedUsers = await prisma.user.deleteMany({
    where: { username: { startsWith: "ci-live" } },
  });

  console.log(
    JSON.stringify(
      {
        claims: removedClaims.count,
        cards: removedCards.count,
        fintech: removedFintech.count,
        users: removedUsers.count,
        audit: removedAudit.count,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
