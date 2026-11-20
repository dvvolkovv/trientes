/**
 * Посев временных данных для живого прогона слайса BP (общий чат команды). Всё, что он
 * создаёт, снимает `scripts/bp-live-clean.ts` по тому же префиксу.
 *
 *   npx tsx scripts/bp-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bplive";
const PASSWORD = "bp-live-pass-7731";

async function user(username: string, name: string, hash: string) {
  return prisma.user.create({
    data: {
      username,
      name,
      role: "USER",
      passwordHash: hash,
      preferredLocale: "en",
      accounts: { create: { provider: "credentials", providerAccountId: username, type: "credentials" } },
    },
    select: { id: true },
  });
}

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await user(`${TAG}_owner`, "BP live owner", hash);
  const keeper = await user(`${TAG}_keeper`, "BP live keeper", hash);
  const watcher = await user(`${TAG}_watcher`, "BP live watcher", hash);

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} GmbH`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "AT",
      city: "Vienna",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  // Кладовщик: своя роль без права на задачи и без чата (его у чата и нет) — чат
  // обязан быть виден ему всё равно: комната принадлежит команде.
  const keeperRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} keeper`,
      permissions: { warehouses: "EDIT" },
      createdById: owner.id,
    },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: keeper.id, role: "VIEWER", roleId: keeperRole.id, invitedById: owner.id },
  });
  // Наблюдатель наследия фазы 10: роли нет, `VIEWER` смотрит всё — и пишет в чат.
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: watcher.id, role: "VIEWER", invitedById: owner.id },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: { owner: `${TAG}_owner`, keeper: `${TAG}_keeper`, watcher: `${TAG}_watcher` },
        ids: { owner: owner.id, keeper: keeper.id, watcher: watcher.id, company: company.id },
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
