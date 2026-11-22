/**
 * Уборка за живым прогоном слайса BX: всё, что завёл `bx-live-seed.ts`.
 *
 *   npx tsx scripts/bx-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "bxlive";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  const userIds = users.map((u) => u.id);
  const productIds = products.map((p) => p.id);
  const warehouses = await prisma.warehouse.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  // Дело правки карточки заведено на id самой правки, а не предприятия: убери
  // только по companyId — и в очереди останется дело без объекта (живой прогон
  // 22 ноября так и оставил одно).
  const revisions = await prisma.companyRevision.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  const revisionIds = revisions.map((r) => r.id);
  const warehouseIds = warehouses.map((w) => w.id);

  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { OR: [{ fromWarehouseId: { in: warehouseIds } }, { toWarehouseId: { in: warehouseIds } }] } }),
    prisma.stockBalance.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    prisma.productOffer.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } }),
    prisma.productEdit.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds } } }),
    prisma.companyDocument.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTeamRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyFollow.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyRevision.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.caseEvent.deleteMany({ where: { case: { subjectId: { in: [...companyIds, ...productIds, ...revisionIds] } } } }),
    prisma.complianceCase.deleteMany({ where: { subjectId: { in: [...companyIds, ...productIds, ...revisionIds] } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
    prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.account.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);

  console.log(`убрано: предприятий ${companies.length}, товаров ${products.length}, записей ${users.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
