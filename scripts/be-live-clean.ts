/**
 * Уборка за живым прогоном слайса BE: всё, что завёл `be-live-seed.ts`.
 *
 *   npx tsx scripts/be-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "be-live";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);

  await prisma.$transaction([
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockBalance.deleteMany({ where: { productId: { in: products.map((p) => p.id) } } }),
    prisma.warehouse.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.productOffer.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.productEdit.deleteMany({ where: { productId: { in: products.map((p) => p.id) } } }),
    prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTeamRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
    prisma.session.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }),
    prisma.account.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }),
    prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }),
  ]);

  console.log(`убрано: предприятий ${companies.length}, паспортов ${products.length}, записей ${users.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
