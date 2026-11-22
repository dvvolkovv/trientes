/**
 * Посев временных данных для живого прогона слайса BU (карточка предприятия:
 * логотип, часы конторы, отрасль, публичные документы). Снимает `bu-live-clean.ts`.
 *
 *   npx tsx scripts/bu-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bulive";
const PASSWORD = "bu-live-pass-4417";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "BU live owner",
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

  // Одна живая точка: с ней умолчание точного адреса — «показывать».
  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: `${TAG} point`,
      status: "APPROVED",
      lat: 50.0875,
      lon: 14.4213,
      countryCode: "CZ",
      city: "Prague",
      address: "Dlouhá 12, Prague",
    },
    select: { id: true },
  });

  // Онлайн-точка: ей слайс BU впервые даёт расписание.
  const online = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "ONLINE",
      name: `${TAG} online`,
      status: "APPROVED",
    },
    select: { id: true },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        login: `${TAG}_owner`,
        ids: { owner: owner.id, company: company.id, point: point.id, online: online.id },
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
