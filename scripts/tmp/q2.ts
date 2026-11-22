import { prisma } from "../../src/lib/prisma";
async function main() {
  const f = await prisma.companyFollow.findMany({ include: { company: { select: { displayName: true, status: true } }, user: { select: { username: true, email: true, preferredLocale: true } } } });
  console.log(JSON.stringify(f, null, 1));
}
main().finally(() => prisma.$disconnect());
