/**
 * Уборка за живым прогоном слайса BU: всё, что завёл `bu-live-seed.ts`, плюс
 * записанные им файлы логотипа и публичных документов.
 *
 *   npx tsx scripts/bu-live-clean.ts
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { companyLogoRoot } from "../src/lib/company-logo";
import { companyDocsRoot } from "../src/lib/company-docs";

const TAG = "bulive";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: TAG } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  const userIds = users.map((u) => u.id);
  const docs = await prisma.companyDocument.count({ where: { companyId: { in: companyIds } } });

  await prisma.$transaction([
    prisma.companyDocument.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyActionLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyPoint.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyRevision.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.complianceCase.deleteMany({ where: { subjectId: { in: companyIds } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
    prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.account.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);

  for (const id of companyIds) {
    await rm(join(companyLogoRoot(), id), { recursive: true, force: true });
    await rm(join(companyDocsRoot(), id), { recursive: true, force: true });
  }

  console.log(`убрано: предприятий ${companies.length}, документов ${docs}, записей ${users.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
