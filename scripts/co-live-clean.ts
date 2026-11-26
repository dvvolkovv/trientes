/**
 * Уборка за живым прогоном слайса CO: всё, что завёл `co-live-seed.ts`, и всё, что
 * родилось само — события, срабатывания, задачи правил, адреса оповещений и доставки.
 *
 *   npx tsx scripts/co-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "colive";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  const userIds = users.map((u) => u.id);
  const productIds = products.map((p) => p.id);
  const warehouses = await prisma.warehouse.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  const warehouseIds = warehouses.map((w) => w.id);

  await prisma.$transaction([
    // Автоматизация (CO): доставки висят на адресе, срабатывания — на правиле, но
    // снимаем явно: уборка должна читаться по строкам, а не надеяться на каскад.
    prisma.webhookDelivery.deleteMany({ where: { webhook: { companyId: { in: companyIds } } } }),
    prisma.companyWebhook.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyRuleRun.deleteMany({ where: { rule: { companyId: { in: companyIds } } } }),
    prisma.companyRule.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyEvent.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.saleLine.deleteMany({ where: { sale: { companyId: { in: companyIds } } } }),
    prisma.sale.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockBalance.deleteMany({ where: { warehouseId: { in: warehouseIds } } }),
    prisma.productOffer.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.reorderRule.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } }),
    prisma.productEdit.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds } } }),
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTaskComment.deleteMany({ where: { task: { companyId: { in: companyIds } } } }),
    prisma.companyTask.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.customerMessage.deleteMany({ where: { thread: { companyId: { in: companyIds } } } }),
    prisma.customerThread.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.merchantApiKey.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMemberPoint.deleteMany({ where: { member: { companyId: { in: companyIds } } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTeamRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.complianceCase.deleteMany({ where: { subjectId: { in: [...companyIds, ...productIds] } } }),
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
