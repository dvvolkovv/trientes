/**
 * Посев временных данных для живого прогона слайса BF (задачи команды). Всё, что он
 * создаёт, снимает `scripts/bf-live-clean.ts` по тому же префиксу.
 *
 *   npx tsx scripts/bf-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bf-live";
const PASSWORD = "bf-live-pass-4471";

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
  const owner = await user(`${TAG}-owner`, "BF live owner", hash);
  const worker = await user(`${TAG}-worker`, "BF live worker", hash);
  const helper = await user(`${TAG}-helper`, "BF live helper", hash);

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

  // Кладовщик: видит доску (`tasks: VIEW`), ведёт склады, участок — первая точка.
  const keeperRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} keeper`,
      permissions: { products: "VIEW", warehouses: "EDIT", tasks: "VIEW" },
      createdById: owner.id,
    },
    select: { id: true },
  });
  // Продуктолог: права на задачи нет вовсе — он должен видеть только свои.
  const clerkRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} clerk`,
      permissions: { products: "VIEW" },
      createdById: owner.id,
    },
    select: { id: true },
  });

  const workerMember = await prisma.companyMember.create({
    data: { companyId: company.id, userId: worker.id, role: "VIEWER", roleId: keeperRole.id, invitedById: owner.id },
    select: { id: true },
  });
  await prisma.companyMemberPoint.create({ data: { memberId: workerMember.id, pointId: points[0].id } });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: helper.id, role: "VIEWER", roleId: clerkRole.id, invitedById: owner.id },
  });

  const shelf = await prisma.warehouse.create({
    data: { companyId: company.id, kind: "SHELF", name: `${TAG} shelf one`, pointId: points[0].id },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      slug: `${TAG}-tea`,
      name: "BF live herbal tea 50 g",
      category: "food",
      language: "en",
      description:
        "Temporary passport for the BF slice live run: herbal tea in a fifty-gram pack. Created by a script and removed by the companion cleanup script.",
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
        logins: { owner: `${TAG}-owner`, worker: `${TAG}-worker`, helper: `${TAG}-helper` },
        ids: { owner: owner.id, worker: worker.id, helper: helper.id, company: company.id },
        points: points.map((p) => ({ id: p.id, name: p.name })),
        shelf: shelf.id,
        product: { id: product.id, slug: product.slug },
        roles: { keeper: keeperRole.id, clerk: clerkRole.id },
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
