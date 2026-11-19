/**
 * Уборка за живым прогоном слайса BF: всё, что завёл `bf-live-seed.ts`.
 *
 *   npx tsx scripts/bf-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "bf-live";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  const userIds = users.map((u) => u.id);
  const productIds = products.map((p) => p.id);
  const tasks = await prisma.companyTask.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });

  await prisma.$transaction([
    prisma.companyTaskComment.deleteMany({ where: { taskId: { in: tasks.map((t) => t.id) } } }),
    prisma.companyTask.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockBalance.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.warehouse.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.productOffer.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.productEdit.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds } } }),
    prisma.companyMemberPoint.deleteMany({ where: { point: { companyId: { in: companyIds } } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTeamRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
    prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.account.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);

  console.log(`убрано: предприятий ${companies.length}, задач ${tasks.length}, записей ${users.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
