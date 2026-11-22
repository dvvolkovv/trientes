/** Уборка живого прогона BV. */
import { prisma } from "../src/lib/prisma";

const TAG = "bvlive";

async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const companies = await prisma.company.findMany({
    where: { ownerUserId: { in: ids } },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  const revisions = await prisma.companyRevision.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true },
  });
  await prisma.complianceCase.deleteMany({
    where: {
      OR: [
        { subjectId: { in: companyIds } },
        { subjectId: { in: revisions.map((r) => r.id) } },
        { applicantUserId: { in: ids } },
      ],
    },
  });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(JSON.stringify({ users: ids.length, companies: companyIds.length }));
}

main().finally(() => prisma.$disconnect());
