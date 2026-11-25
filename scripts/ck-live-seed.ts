/**
 * Посев временных данных для живого прогона слайса CK (касса: продажа, чек, копия
 * покупателю). Снимает `ck-live-clean.ts`.
 *
 *   npx tsx scripts/ck-live-seed.ts
 *
 * Своё предприятие, свои люди, свои товары: живые чужие предприятия в прогоне кассы не
 * трогаются — продажа списывает их товар и выдаёт чек от их имени.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cklive";
const PASSWORD = "ck-live-pass-5517";

async function mkUser(suffix: string, name: string, hash: string) {
  const user = await prisma.user.create({
    data: {
      username: `${TAG}_${suffix}`,
      name,
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}_${suffix}`, type: "credentials" } },
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
  const hash = await hashPassword(PASSWORD);
  const owner = await mkUser("owner", "CK live owner", hash);
  const cashier = await mkUser("cashier", "CK live cashier", hash);
  const observer = await mkUser("observer", "CK live observer", hash);
  const buyer = await mkUser("buyer", "CK live buyer", hash);

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} s.r.o.`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "CZ",
      country: "Czechia",
      city: "Prague",
      address: "Dlouhá 12, 11000 Prague, Czechia",
      description: "Временное предприятие живого прогона CK.",
      category: "grocery",
      // Ставка «на всё»: кэшбэк в чеке должен считаться действующей ставкой, а не нулём.
      cashbackBasePercent: 3,
      timezone: "Europe/Prague",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  const pointA = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: `${TAG} point A`,
      status: "APPROVED",
      lat: 50.0875,
      lon: 14.4213,
      countryCode: "CZ",
      city: "Prague",
      address: "Dlouhá 12, Prague",
    },
    select: { id: true },
  });
  const pointB = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: `${TAG} point B`,
      status: "APPROVED",
      lat: 50.09,
      lon: 14.43,
      countryCode: "CZ",
      city: "Prague",
      address: "Revoluční 1, Prague",
    },
    select: { id: true },
  });

  // Кассир: своя роль по шаблону `cashier` плюс участок из одной точки. Базовая роль —
  // VIEWER, чтобы снос роли понижал, а не повышал (правило BE).
  const cashierRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: `${TAG} кассир`, permissions: { sales: "EDIT", products: "VIEW" } },
    select: { id: true },
  });
  const observerRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: `${TAG} наблюдатель`, permissions: { sales: "VIEW" } },
    select: { id: true },
  });
  const cashierMember = await prisma.companyMember.create({
    data: { companyId: company.id, userId: cashier.id, role: "VIEWER", roleId: cashierRole.id },
    select: { id: true },
  });
  await prisma.companyMemberPoint.create({ data: { memberId: cashierMember.id, pointId: pointA.id } });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: observer.id, role: "VIEWER", roleId: observerRole.id },
  });

  const tea = await prisma.product.create({
    data: {
      slug: `${TAG}-tea`,
      name: `${TAG} чай`,
      category: "food",
      language: "ru",
      description: "Временный товар живого прогона.",
    },
    select: { id: true, slug: true },
  });
  const cut = await prisma.product.create({
    data: {
      slug: `${TAG}-service`,
      name: `${TAG} стрижка`,
      category: "other",
      language: "ru",
      description: "Временная услуга живого прогона.",
    },
    select: { id: true, slug: true },
  });

  const shelfA = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка A`, kind: "SHELF", pointId: pointA.id },
    select: { id: true },
  });
  const shelfB = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка B`, kind: "SHELF", pointId: pointB.id },
    select: { id: true },
  });
  // Остаток наполняется приходом, а не строкой баланса: сверка `scripts/stock-audit.ts`
  // считает остаток по движениям, и посев «из воздуха» выглядел бы в ней расхождением
  // (живой прогон это и показал).
  for (const [shelf, qty] of [[shelfA.id, 5], [shelfB.id, 2]] as const) {
    await prisma.stockMovement.create({
      data: { companyId: company.id, productId: tea.id, kind: "RECEIPT", status: "DONE", toWarehouseId: shelf, qty },
    });
    await prisma.stockBalance.create({ data: { warehouseId: shelf, productId: tea.id, qty } });
  }

  await prisma.productOffer.create({
    data: { companyId: company.id, productId: tea.id, price: 10, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });
  // Услуга: полки не требует и с полки не списывается (единица `service`).
  await prisma.productOffer.create({
    data: {
      companyId: company.id,
      productId: cut.id,
      price: 30,
      currency: "EUR",
      unit: "service",
      status: "ACTIVE",
      cashbackPercent: 10,
    },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_cashier`, `${TAG}_observer`, `${TAG}_buyer`],
        tokens: { owner: owner.token, cashier: cashier.token, observer: observer.token, buyer: buyer.token },
        ids: {
          company: company.id,
          pointA: pointA.id,
          pointB: pointB.id,
          shelfA: shelfA.id,
          shelfB: shelfB.id,
          tea: tea.id,
          service: cut.id,
        },
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
