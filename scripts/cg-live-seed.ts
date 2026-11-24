/**
 * Посев временных данных для живого прогона кнопки «Поделиться» у ссылки
 * приглашения: владелец с готовым сеансом и его предприятие.
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

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "CG live owner",
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: {
        create: { provider: "credentials", providerAccountId: `${TAG}_owner`, type: "credentials" },
      },
    },
    select: { id: true },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 864e5) },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: "CG live tea s.r.o.",
      displayName: "CG live чайная",
      status: "APPROVED",
      countryCode: "CZ",
      city: "Praha",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
    select: { id: true },
  });

  console.log(
    JSON.stringify({ password: PASSWORD, owner: owner.id, session: token, company: company.id }, null, 2),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
