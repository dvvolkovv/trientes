import { prisma } from "../../src/lib/prisma";
import { randomBytes } from "node:crypto";
async function main() {
  const u = await prisma.user.create({
    data: { username: "bxprobe", email: "bxprobe@example.invalid", name: "BX Probe", preferredLocale: "ru" },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { sessionToken: token, userId: u.id, expires: new Date(Date.now() + 864e5) } });
  const company = await prisma.company.findFirst({ select: { id: true } });
  if (company) await prisma.companyFollow.create({ data: { userId: u.id, companyId: company.id } });
  console.log(JSON.stringify({ userId: u.id, token, companyId: company?.id }));
}
main().finally(() => prisma.$disconnect());
