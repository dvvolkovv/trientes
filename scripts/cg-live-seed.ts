/**
 * Посев временных данных для живого прогона «поделиться» и QR у ссылки
 * приглашения (слайсы CG и CH): владелец, кадровик со своей ролью, редактор
 * наследия фазы 10 — у всех готовые сеансы — и их предприятие.
 * Снимает `cg-live-clean.ts`.
 *
 *   npx tsx scripts/cg-live-seed.ts
 *
 * Живые предприятия в прогоне не трогаются: создавать и отзывать приглашения
 * чужой команды ради проверки нельзя.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cglive";
const PASSWORD = "cg-live-pass-4471";

let hash = "";

async function mkUser(suffix: string, name: string) {
  const user = await prisma.user.create({
    data: {
      username: `${TAG}_${suffix}`,
      name,
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: {
        create: { provider: "credentials", providerAccountId: `${TAG}_${suffix}`, type: "credentials" },
      },
    },
    select: { id: true },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 864e5) },
  });
  return { id: user.id, token };
}

async function main() {
  hash = await hashPassword(PASSWORD);
  const owner = await mkUser("owner", "CG live owner");

  const hr = await mkUser("hr", "CG live HR");
  const legacy = await mkUser("legacy", "CG live legacy editor");

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: "CG live tea s.r.o.",
      displayName: "CG live чайная",
      status: "APPROVED",
      countryCode: "CZ",
      city: "Praha",
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          // Кадровик: своя роль с единственным правом `hiring: EDIT`.
          { userId: hr.id, role: "VIEWER" },
          // Редактор наследия фазы 10: своей роли нет вовсе.
          { userId: legacy.id, role: "EDITOR" },
        ],
      },
    },
    select: { id: true },
  });

  const hrRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: "Кадровик", permissions: { hiring: "EDIT", tasks: "VIEW" } },
    select: { id: true },
  });
  await prisma.companyMember.update({
    where: { companyId_userId: { companyId: company.id, userId: hr.id } },
    data: { roleId: hrRole.id },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        company: company.id,
        owner: { id: owner.id, session: owner.token },
        hr: { id: hr.id, session: hr.token },
        legacy: { id: legacy.id, session: legacy.token },
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
