/**
 * Посев временных данных для живого прогона слайса BE (команда мерчанта). Всё, что он
 * создаёт, снимает `scripts/be-live-clean.ts` по тому же префиксу.
 *
 *   npx tsx scripts/be-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "be-live";
const PASSWORD = "be-live-pass-9132";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}-owner`,
      name: "BE live owner",
      role: "USER",
      passwordHash: hash,
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}-owner`, type: "credentials" } },
    },
    select: { id: true },
  });
  const keeper = await prisma.user.create({
    data: {
      username: `${TAG}-keeper`,
      name: "BE live keeper",
      role: "USER",
      passwordHash: hash,
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}-keeper`, type: "credentials" } },
    },
    select: { id: true },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} GmbH`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "AT",
      city: "Vienna",
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          // Приглашённый приходит редактором фазы 10 — наследие, которое слайс и сужает.
          { userId: keeper.id, role: "EDITOR" },
        ],
      },
    },
    select: { id: true },
  });

  const points = [];
  for (const [name, lat, lon] of [
    [`${TAG} point one`, 48.2082, 16.3738],
    [`${TAG} point two`, 48.21, 16.38],
  ] as const) {
    points.push(
      await prisma.companyPoint.create({
        data: {
          companyId: company.id,
          type: "SHOP",
          name,
          status: "APPROVED",
          lat,
          lon,
          countryCode: "AT",
          city: "Vienna",
          acceptedCoinIds: [],
          acceptedCardIds: [],
        },
        select: { id: true, name: true },
      }),
    );
  }

  const shelfOne = await prisma.warehouse.create({
    data: { companyId: company.id, kind: "SHELF", name: `${TAG} shelf one`, pointId: points[0].id },
    select: { id: true },
  });
  const shelfTwo = await prisma.warehouse.create({
    data: { companyId: company.id, kind: "SHELF", name: `${TAG} shelf two`, pointId: points[1].id },
    select: { id: true },
  });
  const central = await prisma.warehouse.create({
    data: { companyId: company.id, kind: "WHOLESALE", name: `${TAG} central` },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      slug: `${TAG}-tea`,
      name: "BE live herbal tea 50 g",
      category: "food",
      language: "en",
      description:
        "Temporary passport for the BE slice live run: herbal tea in a fifty-gram pack. Created by a script and removed by the companion cleanup script.",
      createdByCompanyId: company.id,
    },
    select: { id: true, slug: true },
  });
  await prisma.productOffer.create({
    data: { companyId: company.id, productId: product.id, price: 4.5, currency: "EUR", unit: "pcs" },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        owner: owner.id,
        keeper: keeper.id,
        company: company.id,
        points: points.map((p) => ({ id: p.id, name: p.name })),
        warehouses: { shelfOne: shelfOne.id, shelfTwo: shelfTwo.id, central: central.id },
        product: { id: product.id, slug: product.slug },
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
