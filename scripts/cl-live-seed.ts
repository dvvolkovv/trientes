/**
 * Посев временных данных для живого прогона слайса CL (отчётность: сводка, выгрузка,
 * read-only API). Снимает `cl-live-clean.ts`.
 *
 *   npx tsx scripts/cl-live-seed.ts
 *
 * Своё предприятие и свои чеки: живые чужие продажи в прогоне отчётности не трогаются.
 * Чеки посева заведены прямо в базе — касса CK уже проверена живым прогоном, а здесь
 * нужен период с разными валютами, способами оплаты, точками и кассирами. Одну продажу
 * живой кассой прогон делает руками и смотрит, как она попадает в сводку.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cllive";
const PASSWORD = "cl-live-pass-7731";

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

function daysAgo(days: number, hour = 12): Date {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - days);
  at.setUTCHours(hour, 0, 0, 0);
  return at;
}

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await mkUser("owner", "CL live owner", hash);
  const accountant = await mkUser("acct", "CL live accountant", hash);
  const cashier = await mkUser("cashier", "CL live cashier", hash);

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
      description: "Временное предприятие живого прогона CL.",
      category: "grocery",
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
      timezone: "Europe/Prague",
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
      timezone: "Europe/Prague",
    },
    select: { id: true },
  });

  // Бухгалтер — шаблон `accountant` слайса CL: отчёты выгружает, кассой не работает.
  const acctRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} бухгалтер`,
      permissions: { reports: "EDIT", sales: "VIEW", products: "VIEW" },
    },
    select: { id: true },
  });
  // Кассир с участком из одной точки: сводка обязана сужаться участком так же, как
  // список чеков в кассе, и выгрузка — тоже.
  const cashierRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} кассир`,
      // `reports: VIEW` без `EDIT` — проверка слов «смотреть можно, выгружать нельзя».
      permissions: { sales: "EDIT", products: "VIEW", reports: "VIEW" },
    },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: accountant.id, role: "VIEWER", roleId: acctRole.id },
  });
  const cashierMember = await prisma.companyMember.create({
    data: { companyId: company.id, userId: cashier.id, role: "VIEWER", roleId: cashierRole.id },
    select: { id: true },
  });
  await prisma.companyMemberPoint.create({ data: { memberId: cashierMember.id, pointId: pointA.id } });

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

  const shelfA = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка A`, kind: "SHELF", pointId: pointA.id },
    select: { id: true },
  });
  await prisma.stockMovement.create({
    data: { companyId: company.id, productId: tea.id, kind: "RECEIPT", status: "DONE", toWarehouseId: shelfA.id, qty: 50 },
  });
  await prisma.stockBalance.create({ data: { warehouseId: shelfA.id, productId: tea.id, qty: 50 } });
  await prisma.productOffer.create({
    data: { companyId: company.id, productId: tea.id, price: 10, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });

  // Чеки периода: две валюты, четыре способа оплаты, две точки, два кассира, один
  // отменённый и один за пределами «сегодня».
  const receipts = [
    { n: 1, at: daysAgo(0, 9), currency: "EUR", list: 100, total: 90, cashback: 4.5, payment: "CASH" as const, point: pointA.id, by: owner.id, qty: 2, listPrice: 50, price: 45 },
    { n: 2, at: daysAgo(0, 10), currency: "EUR", list: 10, total: 10, cashback: 0.3, payment: "CARD" as const, point: pointB.id, by: cashier.id, qty: 1, listPrice: 10, price: 10 },
    { n: 3, at: daysAgo(3, 14), currency: "CZK", list: 500, total: 500, cashback: 15, payment: "CRYPTO" as const, point: pointA.id, by: owner.id, qty: 5, listPrice: 100, price: 100 },
    { n: 4, at: daysAgo(10, 11), currency: "EUR", list: 20, total: 20, cashback: 0.6, payment: "TRANSFER" as const, point: pointA.id, by: cashier.id, qty: 2, listPrice: 10, price: 10 },
  ];
  for (const r of receipts) {
    await prisma.sale.create({
      data: {
        companyId: company.id,
        number: r.n,
        warehouseId: shelfA.id,
        pointId: r.point,
        currency: r.currency,
        listTotal: r.list,
        total: r.total,
        cashbackTotal: r.cashback,
        payment: r.payment,
        ...(r.payment === "CRYPTO" ? { payCoin: "BTC", payRate: 91000, payCoinAmount: 0.00022 } : {}),
        status: "COMPLETED",
        createdById: r.by,
        createdAt: r.at,
        lines: {
          create: [
            {
              productId: tea.id,
              name: `${TAG} чай`,
              unit: "pcs",
              qty: r.qty,
              listPrice: r.listPrice,
              price: r.price,
              cashbackPercent: 3,
              cashbackAmount: r.cashback,
            },
          ],
        },
      },
    });
  }
  await prisma.sale.create({
    data: {
      companyId: company.id,
      number: 5,
      pointId: pointA.id,
      currency: "EUR",
      listTotal: 40,
      total: 40,
      cashbackTotal: 1.2,
      payment: "CASH",
      status: "CANCELLED",
      cancelReason: "покупатель передумал",
      cancelledAt: daysAgo(0, 11),
      createdById: owner.id,
      createdAt: daysAgo(0, 11),
      lines: {
        create: [
          { productId: tea.id, name: `${TAG} чай`, unit: "pcs", qty: 4, listPrice: 10, price: 10, cashbackPercent: 3, cashbackAmount: 1.2 },
        ],
      },
    },
  });
  await prisma.company.update({ where: { id: company.id }, data: { saleSeq: 5 } });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_acct`, `${TAG}_cashier`],
        tokens: { owner: owner.token, accountant: accountant.token, cashier: cashier.token },
        ids: { company: company.id, pointA: pointA.id, pointB: pointB.id, shelfA: shelfA.id, tea: tea.id },
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
