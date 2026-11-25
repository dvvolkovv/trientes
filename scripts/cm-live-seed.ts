/**
 * Посев временных данных для живого прогона слайса CM (сводка рабочего дня).
 * Снимает `cm-live-clean.ts`.
 *
 *   npx tsx scripts/cm-live-seed.ts
 *
 * Своё предприятие: живые чужие продажи, задачи и переписка в прогоне не трогаются.
 * Нужны все пять чисел ТЗ сразу и разные роли — чтобы увидеть, что сводка не обходит
 * права: у кладовщика не должно быть ни выручки, ни переписки.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cmlive";
const PASSWORD = "cm-live-pass-4420";

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

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600 * 1000);
}
function daysAgo(days: number, hour = 12): Date {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - days);
  at.setUTCHours(hour, 0, 0, 0);
  return at;
}

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await mkUser("owner", "CM live owner", hash);
  const keeper = await mkUser("keeper", "CM live keeper", hash);
  const marketer = await mkUser("mkt", "CM live marketer", hash);
  const buyer = await mkUser("buyer", "CM live buyer", hash);

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
      description: "Временное предприятие живого прогона CM.",
      category: "grocery",
      cashbackBasePercent: 3,
      timezone: "Europe/Prague",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  const pointA = await prisma.companyPoint.create({
    data: {
      companyId: company.id, type: "SHOP", name: `${TAG} point A`, status: "APPROVED",
      lat: 50.0875, lon: 14.4213, countryCode: "CZ", city: "Prague",
      address: "Dlouhá 12, Prague", timezone: "Europe/Prague",
    },
    select: { id: true },
  });
  const pointB = await prisma.companyPoint.create({
    data: {
      companyId: company.id, type: "SHOP", name: `${TAG} point B`, status: "APPROVED",
      lat: 50.09, lon: 14.43, countryCode: "CZ", city: "Prague",
      address: "Revoluční 1, Prague", timezone: "Europe/Prague",
    },
    select: { id: true },
  });

  // Кладовщик по шаблону BE: склады и задачи, кассы и переписки нет вовсе.
  const keeperRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} кладовщик`,
      permissions: { points: "VIEW", products: "VIEW", warehouses: "EDIT", tasks: "VIEW", supply: "VIEW" },
    },
    select: { id: true },
  });
  const mktRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} маркетолог`,
      permissions: { card: "EDIT", products: "VIEW", pricing: "EDIT", tasks: "VIEW", promos: "EDIT", customers: "EDIT" },
    },
    select: { id: true },
  });
  const keeperMember = await prisma.companyMember.create({
    data: { companyId: company.id, userId: keeper.id, role: "VIEWER", roleId: keeperRole.id },
    select: { id: true },
  });
  // Участок из одной точки: сводка обязана сужаться участком так же, как разделы.
  await prisma.companyMemberPoint.create({ data: { memberId: keeperMember.id, pointId: pointA.id } });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: marketer.id, role: "VIEWER", roleId: mktRole.id },
  });

  const tea = await prisma.product.create({
    data: { slug: `${TAG}-tea`, name: `${TAG} чай`, category: "food", language: "ru", description: "Временный товар живого прогона." },
    select: { id: true, slug: true },
  });
  const jam = await prisma.product.create({
    data: { slug: `${TAG}-jam`, name: `${TAG} варенье`, category: "food", language: "ru", description: "Временный товар живого прогона." },
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
  const central = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} оптовый`, kind: "WHOLESALE" },
    select: { id: true },
  });

  // Остатки: чай на полке A в наличии, варенье кончилось (ноль) — это и есть число
  // «кончилось на полках»; на оптовом складе ноль не считается (разбор § спеки).
  await prisma.stockBalance.create({ data: { warehouseId: shelfA.id, productId: tea.id, qty: 8 } });
  await prisma.stockBalance.create({ data: { warehouseId: shelfA.id, productId: jam.id, qty: 0 } });
  await prisma.stockBalance.create({ data: { warehouseId: central.id, productId: jam.id, qty: 0 } });
  // Полка B вне участка кладовщика: её ноль он видеть не должен.
  await prisma.stockBalance.create({ data: { warehouseId: shelfB.id, productId: tea.id, qty: 0 } });
  await prisma.stockMovement.create({
    data: { companyId: company.id, productId: tea.id, kind: "RECEIPT", status: "DONE", toWarehouseId: shelfA.id, qty: 8 },
  });
  // Груз в пути на полку A.
  await prisma.stockMovement.create({
    data: {
      companyId: company.id, productId: jam.id, kind: "TRANSFER", status: "IN_TRANSIT",
      fromWarehouseId: central.id, toWarehouseId: shelfA.id, qty: 24, carrierName: "DPD", trackingCode: "CM-77", shippedAt: new Date(),
    },
  });

  await prisma.productOffer.create({
    data: { companyId: company.id, productId: tea.id, price: 10, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });

  // Поставщик и правило автозаказа ниже порога: чая 8 при пороге 10.
  const supplier = await prisma.supplier.create({
    data: { companyId: company.id, name: `${TAG} поставщик`, email: "supplier@example.org" },
    select: { id: true },
  });
  await prisma.reorderRule.create({
    data: { companyId: company.id, warehouseId: shelfA.id, productId: tea.id, supplierId: supplier.id, minQty: 10, targetQty: 40 },
  });
  // Второе правило — выше порога, чтобы число «ниже порога» не оказалось «все правила».
  await prisma.reorderRule.create({
    data: { companyId: company.id, warehouseId: central.id, productId: jam.id, supplierId: supplier.id, minQty: -1, targetQty: 5 },
  });

  // Задачи: открытая на кладовщика, просроченная, одна на проверке, одна закрытая.
  await prisma.companyTask.create({
    data: {
      companyId: company.id, title: `${TAG} разложить чай`, status: "NEW", priority: "NORMAL",
      createdById: owner.id, assigneeId: keeper.id, assignedAt: new Date(), pointId: pointA.id,
      dueAt: daysAgo(-3, 23),
    },
  });
  await prisma.companyTask.create({
    data: {
      companyId: company.id, title: `${TAG} пересчитать склад`, status: "IN_PROGRESS", priority: "HIGH",
      createdById: owner.id, assigneeId: keeper.id, assignedAt: daysAgo(5), takenById: keeper.id,
      takenAt: daysAgo(4), pointId: pointA.id, dueAt: daysAgo(2, 23),
    },
  });
  await prisma.companyTask.create({
    data: {
      companyId: company.id, title: `${TAG} витрина к празднику`, status: "ON_REVIEW", priority: "NORMAL",
      createdById: owner.id, assigneeId: marketer.id, assignedAt: daysAgo(2), takenById: marketer.id,
      takenAt: daysAgo(2), submittedById: marketer.id, submittedAt: hoursAgo(3),
    },
  });
  await prisma.companyTask.create({
    data: {
      companyId: company.id, title: `${TAG} закрытая задача`, status: "DONE", priority: "LOW",
      createdById: owner.id, assigneeId: keeper.id, closedById: owner.id, closedAt: hoursAgo(20),
    },
  });

  // Акции: одна идёт, одна уже кончилась; плюс материал в карусели и материал у модератора.
  await prisma.merchantPromo.create({
    data: {
      companyId: company.id, title: `${TAG} скидка на чай`, body: "Минус десять процентов до конца недели.",
      startsAt: daysAgo(1), endsAt: daysAgo(-6), productId: tea.id, pointId: pointA.id,
    },
  });
  await prisma.merchantPromo.create({
    data: {
      companyId: company.id, title: `${TAG} прошлая акция`, body: "Уже закончилась.",
      startsAt: daysAgo(20), endsAt: daysAgo(14),
    },
  });
  await prisma.companyAd.create({
    data: {
      companyId: company.id, kind: "PROMO", title: `${TAG} баннер в карусели`, body: "Текст баннера.",
      language: "ru", mediaKind: "IMAGE", mediaUrl: "/uploads/ads/cm-live.png", status: "PUBLISHED",
      startsAt: daysAgo(1), decidedAt: daysAgo(1),
    },
  });
  await prisma.companyAd.create({
    data: {
      companyId: company.id, kind: "PROMO", title: `${TAG} баннер у модератора`, body: "Текст баннера.",
      language: "ru", mediaKind: "IMAGE", mediaUrl: "/uploads/ads/cm-live2.png", status: "PENDING",
      submittedAt: hoursAgo(2),
    },
  });

  // Переписка покупателя: два его сообщения, магазин их не читал.
  const thread = await prisma.customerThread.create({
    data: { companyId: company.id, customerUserId: buyer.id, customerReadAt: new Date() },
    select: { id: true },
  });
  await prisma.customerMessage.create({
    data: { threadId: thread.id, side: "CUSTOMER", authorUserId: buyer.id, body: "Здравствуйте, чай ещё есть?", createdAt: hoursAgo(5) },
  });
  await prisma.customerMessage.create({
    data: { threadId: thread.id, side: "CUSTOMER", authorUserId: buyer.id, body: "И до какого часа вы работаете?", createdAt: hoursAgo(4) },
  });

  // Чеки: два за сегодня (две валюты), один отменённый за сегодня, один за неделю.
  const receipts = [
    { n: 1, at: hoursAgo(6), currency: "EUR", list: 100, total: 90, cashback: 4.5, payment: "CASH" as const, point: pointA.id, qty: 2, listPrice: 50, price: 45 },
    { n: 2, at: hoursAgo(2), currency: "CZK", list: 500, total: 500, cashback: 15, payment: "CARD" as const, point: pointB.id, qty: 5, listPrice: 100, price: 100 },
    { n: 3, at: daysAgo(3, 14), currency: "EUR", list: 20, total: 20, cashback: 0.6, payment: "TRANSFER" as const, point: pointA.id, qty: 2, listPrice: 10, price: 10 },
  ];
  for (const r of receipts) {
    await prisma.sale.create({
      data: {
        companyId: company.id, number: r.n, warehouseId: shelfA.id, pointId: r.point,
        currency: r.currency, listTotal: r.list, total: r.total, cashbackTotal: r.cashback,
        payment: r.payment, status: "COMPLETED", createdById: owner.id, createdAt: r.at,
        lines: {
          create: [
            { productId: tea.id, name: `${TAG} чай`, unit: "pcs", qty: r.qty, listPrice: r.listPrice, price: r.price, cashbackPercent: 3, cashbackAmount: r.cashback },
          ],
        },
      },
    });
  }
  await prisma.sale.create({
    data: {
      companyId: company.id, number: 4, pointId: pointA.id, currency: "EUR", listTotal: 40, total: 40,
      cashbackTotal: 1.2, payment: "CASH", status: "CANCELLED", cancelReason: "покупатель передумал",
      cancelledAt: hoursAgo(1), createdById: owner.id, createdAt: hoursAgo(1),
      lines: {
        create: [
          { productId: tea.id, name: `${TAG} чай`, unit: "pcs", qty: 4, listPrice: 10, price: 10, cashbackPercent: 3, cashbackAmount: 1.2 },
        ],
      },
    },
  });
  await prisma.company.update({ where: { id: company.id }, data: { saleSeq: 4 } });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_keeper`, `${TAG}_mkt`, `${TAG}_buyer`],
        tokens: { owner: owner.token, keeper: keeper.token, marketer: marketer.token, buyer: buyer.token },
        ids: { company: company.id, pointA: pointA.id, pointB: pointB.id, shelfA: shelfA.id, tea: tea.id, jam: jam.id },
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
