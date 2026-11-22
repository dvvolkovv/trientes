/**
 * Посев временных данных для живого прогона слайса BW (выключатель политики
 * возврата и кнопка возврата в кабинет). Снимает `bw-live-clean.ts`.
 *
 *   npx tsx scripts/bw-live-seed.ts
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bwlive";
const PASSWORD = "bw-live-pass-7731";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "BW live owner",
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
      returnDays: 14,
      returnPolicy: "Возврат в течение 14 дней с чеком.",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

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

  // Товар с предложением и полкой: строка возврата видна и в «Где взять».
  const product = await prisma.product.create({
    data: {
      slug: `${TAG}-tea`,
      name: `${TAG} чай`,
      category: "food",
      language: "ru",
      description: "Временный товар живого прогона.",
    },
    select: { id: true, slug: true },
  });
  const shelf = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка`, kind: "SHELF", pointId: point.id },
    select: { id: true },
  });
  await prisma.stockBalance.create({ data: { warehouseId: shelf.id, productId: product.id, qty: 10 } });
  await prisma.productOffer.create({
    data: { companyId: company.id, productId: product.id, price: 99, currency: "CZK", unit: "pcs", status: "ACTIVE" },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        login: `${TAG}_owner`,
        ids: { owner: owner.id, company: company.id, point: point.id, product: product.id },
        productSlug: product.slug,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
