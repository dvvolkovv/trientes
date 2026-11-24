/**
 * Убирает посев `cg-live-seed.ts`. Идемпотентен: нечего убирать — молчит.
 *
 *   npx tsx scripts/cg-live-clean.ts
 */
import { prisma } from "../src/lib/prisma";

const TAG = "cglive";

async function main() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: `${TAG}_` } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const companies = await prisma.company.findMany({
    where: { ownerUserId: { in: ids } },
    select: { id: true },
  });
  for (const c of companies) {
    await prisma.companyInvite.deleteMany({ where: { companyId: c.id } });
    await prisma.companyMember.deleteMany({ where: { companyId: c.id } });
    await prisma.companyActionLog.deleteMany({ where: { companyId: c.id } });
    await prisma.company.delete({ where: { id: c.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(JSON.stringify({ users: ids.length, companies: companies.length }));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
