/**
 * Посев живого прогона слайса CP (приём платежей в карточке магазина).
 *
 * Прогон идёт в **отдельной схеме** базы (`?schema=cp_preview`), а не в проде: слайс
 * ещё не выложен, миграция в прод не применена, и трогать живые предприятия ради
 * снимков нельзя. Схема создаётся и сносится вместе с прогоном.
 *
 * Запуск: `DATABASE_URL="$DATABASE_URL?schema=cp_preview" npx tsx scripts/cp-live-seed.ts`
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const suffix = randomBytes(3).toString("hex");
  const owner = await prisma.user.create({
    data: {
      username: `cplive_owner_${suffix}`,
      name: "CP live owner",
      email: `cplive_owner_${suffix}@example.org`,
      emailVerified: new Date(),
      preferredLocale: "ru",
      passwordHash: await hashPassword("cp-live-password"),
    },
  });
  const guest = await prisma.user.create({
    data: { username: `cplive_guest_${suffix}`, name: "CP live guest", preferredLocale: "ru" },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `CP live s.r.o. ${suffix}`,
      displayName: "CP live кофейня",
      status: "APPROVED",
      country: "Czechia",
      countryCode: "CZ",
      city: "Praha",
      street: "Dlouhá",
      houseNumber: "12",
      postalCode: "11000",
      address: "Dlouhá 12, 11000 Praha, Czechia",
      phone: "+420 222 333 444",
      email: `shop_${suffix}@example.org`,
      website: "https://example.org",
      description: "Временное предприятие живого прогона приёма платежей.",
      category: "cafe",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });

  await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: "CP live кофейня — Dlouhá",
      address: "Dlouhá 12, Praha",
      city: "Praha",
      countryCode: "CZ",
      lat: 50.0885,
      lon: 14.4215,
      status: "APPROVED",
      timezone: "Europe/Prague",
    },
  });

  const ownerSession = randomBytes(24).toString("hex");
  const guestSession = randomBytes(24).toString("hex");
  await prisma.session.createMany({
    data: [
      { sessionToken: ownerSession, userId: owner.id, expires: new Date(Date.now() + 3600_000) },
      { sessionToken: guestSession, userId: guest.id, expires: new Date(Date.now() + 3600_000) },
    ],
  });

  console.log(
    JSON.stringify(
      { companyId: company.id, ownerId: owner.id, guestId: guest.id, ownerSession, guestSession },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
