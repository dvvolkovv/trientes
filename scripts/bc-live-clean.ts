/**
 * Уборка за живым прогоном слайса BC: всё, что завёл `bc-live-seed.ts`.
 *
 *   npx tsx scripts/bc-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "bc-live";

async function main() {
  const user = await prisma.user.findFirst({ where: { username: `${TAG}-owner` }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });

  // Движения и балансы уходят каскадом от склада, предложения — от предприятия; но
  // сначала снимаем паспорта: у них свои каскады, а у журнала правок — автор.
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } }),
    prisma.stockBalance.deleteMany({ where: { productId: { in: products.map((p) => p.id) } } }),
    prisma.warehouse.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } }),
    prisma.productOffer.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } }),
    prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } }),
    prisma.company.deleteMany({ where: { id: { in: companies.map((c) => c.id) } } }),
    ...(user ? [prisma.user.delete({ where: { id: user.id } })] : []),
  ]);

  console.log(`убрано: предприятий ${companies.length}, паспортов ${products.length}, запись ${user ? 1 : 0}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
