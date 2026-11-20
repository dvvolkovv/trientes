/**
 * Уборка за живым прогоном слайса BP: всё, что завёл `bp-live-seed.ts`.
 *
 *   npx tsx scripts/bp-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "bplive";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  const userIds = users.map((u) => u.id);
  const messages = await prisma.companyChatMessage.count({ where: { companyId: { in: companyIds } } });

  await prisma.$transaction([
    prisma.companyChatMessage.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyChatRead.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTeamRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
    prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.account.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);

  console.log(`убрано: предприятий ${companies.length}, сообщений ${messages}, записей ${users.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
