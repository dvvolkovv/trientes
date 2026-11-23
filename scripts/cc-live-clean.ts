/** Уборка живого прогона CC. */
import { prisma } from "../src/lib/prisma";
async function main() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: "cclive_" } }, select: { id: true } });
  for (const u of users) {
    await prisma.adminAuditLog.deleteMany({ where: { actorId: u.id } });
    await prisma.staffGrant.deleteMany({ where: { userId: u.id } });
    await prisma.staffMember.deleteMany({ where: { userId: u.id } });
  }
  const companies = await prisma.company.findMany({ where: { legalName: { startsWith: "cclive" } }, select: { id: true } });
  for (const c of companies) {
    const ads = await prisma.companyAd.findMany({ where: { companyId: c.id }, select: { id: true } });
    for (const a of ads) {
      await prisma.caseEvent.deleteMany({ where: { case: { subjectType: "COMPANY_AD", subjectId: a.id } } });
      await prisma.caseCheck.deleteMany({ where: { case: { subjectType: "COMPANY_AD", subjectId: a.id } } });
      await prisma.complianceCase.deleteMany({ where: { subjectType: "COMPANY_AD", subjectId: a.id } });
      await prisma.adminAuditLog.deleteMany({ where: { targetType: "CompanyAd", targetId: a.id } });
    }
    await prisma.complianceCase.deleteMany({ where: { subjectId: c.id } });
  }
  for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch((e) => console.error(e.message));
  console.log(`cleaned users=${users.length} companies=${companies.length}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
