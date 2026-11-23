/**
 * Посев для живого прогона починки CD: поиск адреса в студии ставит булавку, а
 * у места опубликованного материала на карте стоит знак предприятия.
 * Снимает `cd-live-clean.ts`.
 *
 *   npx tsx scripts/cd-live-seed.ts
 *
 * Живая ALTA Invest в прогоне только читается: завести у чужого предприятия
 * материал ради проверки нельзя.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cdlive";
const PASSWORD = "cd-live-pass-4471";
/// Логотип и кадр одолжены у живого предприятия: файлы только читаются, а
/// метке на карте нужен настоящий растр.
const LOGO = "/uploads/companies/cmwm2jtfr0009d7fcink72rv7/2ed6458a4be1e1af4a9832a2.jpg";
const PHOTO = "/uploads/points/cmwm2jtfr0009d7fcink72rv7/ada437967cb96e6ef5fb27ed.jpg";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "CD live owner",
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}_owner`, type: "credentials" } },
    },
    select: { id: true },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 864e5) },
  });

  // Страна — Австрия: адрес прогона тот самый, на котором владелец и наткнулся
  // на «ничего не происходит».
  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} GmbH`,
      displayName: `${TAG} invest`,
      status: "APPROVED",
      countryCode: "AT",
      country: "Austria",
      city: "Wien",
      street: "Brehmstraße",
      houseNumber: "19",
      postalCode: "1020",
      address: "Brehmstraße 19, 1020 Wien, Austria",
      email: `${TAG}@example.org`,
      website: "https://example.org",
      logoUrl: LOGO,
      description: "Временное предприятие живого прогона CD.",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
    select: { id: true },
  });

  // Опубликованный материал с местом: ради него и открывается карта.
  const ad = await prisma.companyAd.create({
    data: {
      companyId: company.id,
      kind: "PROMO",
      title: "Квартиры в Вене",
      body: "Временный материал живого прогона CD.",
      language: "ru",
      mediaKind: "IMAGE",
      mediaUrl: PHOTO,
      status: "PUBLISHED",
      submittedAt: new Date(),
      decidedAt: new Date(),
      placeName: "Офис продаж",
      placeAddress: "Brehmstraße 19, 1020 Wien, Austria",
      placeLat: 48.1759373,
      placeLon: 16.4052193,
      placePaymentMethods: ["cash"],
    },
    select: { id: true },
  });

  console.log(JSON.stringify({ owner: owner.id, token, company: company.id, ad: ad.id, password: PASSWORD }));
}

main().finally(() => prisma.$disconnect());
