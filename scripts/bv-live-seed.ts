/**
 * Посев временных данных для живого прогона слайса BV (реквизиты, рубрики
 * документов, плитка «+», колокольчик). Снимает `bv-live-clean.ts`.
 *
 *   npx tsx scripts/bv-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bvlive";
const PASSWORD = "bv-live-pass-7731";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "BV live owner",
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}_owner`, type: "credentials" } },
    },
    select: { id: true },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} s.r.o.`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "CZ",
      country: "Czechia",
      city: "Prague",
      street: "Dlouhá",
      houseNumber: "12",
      postalCode: "11000",
      address: "Dlouhá 12, 11000 Prague, Czechia",
      phone: "+420 123 456 789",
      email: `${TAG}@example.org`,
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  // Дело комплайнса с непрочитанным сообщением сотрудника: его должен поймать
  // колокольчик на плитке и блок «требует внимания».
  const kase = await prisma.complianceCase.create({
    data: {
      subjectType: "COMPANY",
      subjectId: company.id,
      title: `${TAG} shop`,
      applicantUserId: owner.id,
      status: "WAITING_APPLICANT",
      dueAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      slaSeconds: 5 * 24 * 3600,
      messages: {
        create: {
          side: "STAFF",
          body: "Пришлите, пожалуйста, выписку из торгового реестра.",
        },
      },
    },
    select: { id: true },
  });

  console.log(
    JSON.stringify(
      { password: PASSWORD, login: `${TAG}_owner`, ids: { owner: owner.id, company: company.id, case: kase.id } },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
