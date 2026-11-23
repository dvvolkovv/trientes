/** Уборка за живым прогоном CD: сносит всё, что завёл `cd-live-seed.ts`. */
import { prisma } from "../src/lib/prisma";

const TAG = "cdlive";

async function main() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: `${TAG}_` } },
    select: { id: true },
  });
  const companies = await prisma.company.findMany({
    where: { displayName: { startsWith: `${TAG} ` } },
    select: { id: true },
  });
  for (const c of companies) {
    await prisma.companyAd.deleteMany({ where: { companyId: c.id } });
    await prisma.company.delete({ where: { id: c.id } });
  }
  for (const u of users) await prisma.user.delete({ where: { id: u.id } });
  console.log(`убрано: предприятий ${companies.length}, записей ${users.length}`);
}

main().finally(() => prisma.$disconnect());
