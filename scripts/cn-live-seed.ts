/**
 * Посев временных данных для живого прогона слайса CN (сегменты покупателей и адресная
 * рассылка). Снимает `cn-live-clean.ts`.
 *
 *   npx tsx scripts/cn-live-seed.ts
 *
 * Своё предприятие: живых покупателей чужих магазинов прогон не трогает. Нужны все шесть
 * сегментов сразу и люди по разные стороны согласия — чтобы увидеть главное правило
 * слайса: сегмент сужает аудиторию подписчиков, но не расширяет её.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "cnlive";
const PASSWORD = "cn-live-pass-7731";

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
  const owner = await mkUser("owner", "CN live owner", hash);
  const marketer = await mkUser("mkt", "CN live marketer", hash);
  const keeper = await mkUser("keeper", "CN live keeper", hash);
  // Шесть человек по шести признакам: постоянный, спящий подписчик, спящий без
  // подписки, новый, подписчик без покупок и тот, кто только написал.
  const regular = await mkUser("regular", "CN live regular", hash);
  const dormantFollower = await mkUser("dormfollow", "CN live dormant follower", hash);
  const dormantOff = await mkUser("dormoff", "CN live dormant offline", hash);
  const newcomer = await mkUser("newcomer", "CN live newcomer", hash);
  const follower = await mkUser("follower", "CN live follower", hash);
  const talker = await mkUser("talker", "CN live talker", hash);

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} s.r.o.`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "CZ",
      country: "Czechia",
      city: "Prague",
      address: "Dlouhá 14, 11000 Prague, Czechia",
      description: "Временное предприятие живого прогона CN.",
      category: "grocery",
      cashbackBasePercent: 3,
      timezone: "Europe/Prague",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id, type: "SHOP", name: `${TAG} point`, status: "APPROVED",
      lat: 50.0881, lon: 14.4221, countryCode: "CZ", city: "Prague",
      address: "Dlouhá 14, Prague", timezone: "Europe/Prague",
    },
    select: { id: true },
  });

  // Маркетолог: переписка и акции есть, кассы и отчётности нет вовсе — он не должен
  // видеть ни одной суммы (правило «деньги охраняются деньгами»).
  const mktRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} маркетолог`,
      permissions: { card: "VIEW", products: "VIEW", promos: "EDIT", customers: "EDIT" },
    },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: marketer.id, role: "VIEWER", roleId: mktRole.id },
  });
  const keeperRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: `${TAG} кладовщик`, permissions: { warehouses: "EDIT", products: "VIEW" } },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: keeper.id, role: "VIEWER", roleId: keeperRole.id },
  });

  const tea = await prisma.product.create({
    data: { slug: `${TAG}-tea`, name: `${TAG} чай`, category: "food", language: "ru", description: "Временный товар живого прогона." },
    select: { id: true, slug: true },
  });
  const shelf = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка`, kind: "SHELF", pointId: point.id },
    select: { id: true },
  });
  await prisma.productOffer.create({
    data: { companyId: company.id, productId: tea.id, price: 10, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });

  // Подписки — единственное согласие на рассылку. Спящий без подписки и написавший
  // без подписки заведены нарочно: рассылка их не достанет, и это видно числом.
  await prisma.companyFollow.createMany({
    data: [
      { companyId: company.id, userId: regular.id },
      { companyId: company.id, userId: dormantFollower.id, muted: true },
      { companyId: company.id, userId: newcomer.id },
      { companyId: company.id, userId: follower.id },
    ],
  });

  let number = 0;
  const sale = async (opts: {
    buyer: string | null;
    at: Date;
    currency: string;
    total: number;
    list?: number;
    cashback: number;
    cancelled?: boolean;
    qty: number;
  }) => {
    number += 1;
    await prisma.sale.create({
      data: {
        companyId: company.id,
        number,
        warehouseId: shelf.id,
        pointId: point.id,
        currency: opts.currency,
        listTotal: opts.list ?? opts.total,
        total: opts.total,
        cashbackTotal: opts.cashback,
        payment: "CASH",
        status: opts.cancelled ? "CANCELLED" : "COMPLETED",
        cancelReason: opts.cancelled ? "покупатель передумал" : null,
        cancelledAt: opts.cancelled ? opts.at : null,
        buyerUserId: opts.buyer,
        buyerClaimedAt: opts.buyer ? opts.at : null,
        createdById: owner.id,
        createdAt: opts.at,
        lines: {
          create: [
            {
              productId: tea.id, name: `${TAG} чай`, unit: "pcs", qty: opts.qty,
              listPrice: 10, price: opts.total / opts.qty, cashbackPercent: 3, cashbackAmount: opts.cashback,
            },
          ],
        },
      },
    });
  };

  // Постоянный: четыре исполненных чека в окне, один отменённый и вторая валюта.
  await sale({ buyer: regular.id, at: daysAgo(2), currency: "EUR", total: 30, cashback: 0.9, qty: 3 });
  await sale({ buyer: regular.id, at: daysAgo(20), currency: "EUR", total: 20, cashback: 0.6, qty: 2 });
  await sale({ buyer: regular.id, at: daysAgo(60), currency: "EUR", total: 50, list: 60, cashback: 1.5, qty: 6 });
  await sale({ buyer: regular.id, at: daysAgo(90), currency: "CZK", total: 500, cashback: 15, qty: 5 });
  await sale({ buyer: regular.id, at: daysAgo(5), currency: "EUR", total: 40, cashback: 1.2, qty: 4, cancelled: true });
  // Спящие: последний чек старше тридцати дней.
  await sale({ buyer: dormantFollower.id, at: daysAgo(45), currency: "EUR", total: 10, cashback: 0.3, qty: 1 });
  await sale({ buyer: dormantFollower.id, at: daysAgo(120), currency: "EUR", total: 10, cashback: 0.3, qty: 1 });
  await sale({ buyer: dormantOff.id, at: daysAgo(70), currency: "EUR", total: 10, cashback: 0.3, qty: 1 });
  // Новый: одна покупка, и она свежая.
  await sale({ buyer: newcomer.id, at: daysAgo(3), currency: "EUR", total: 10, cashback: 0.3, qty: 1 });
  // Чек, который покупатель не привязал: он анонимен, и экран скажет это отдельной строкой.
  await sale({ buyer: null, at: daysAgo(1), currency: "EUR", total: 10, cashback: 0.3, qty: 1 });
  await prisma.company.update({ where: { id: company.id }, data: { saleSeq: number } });

  // Написавший: его сообщение — это «активность» ТЗ. Подписки у него нет.
  const talkerThread = await prisma.customerThread.create({
    data: { companyId: company.id, customerUserId: talker.id, lastMessageAt: daysAgo(2) },
    select: { id: true },
  });
  await prisma.customerMessage.create({
    data: { threadId: talkerThread.id, side: "CUSTOMER", authorUserId: talker.id, body: "А доставка у вас есть?", createdAt: daysAgo(2) },
  });
  // Нитка постоянного, где писал **только магазин**: наш ответ активностью человека
  // не является, поэтому в сегмент «писал нам» он не попадает, а ссылка в переписку есть.
  const regularThread = await prisma.customerThread.create({
    data: { companyId: company.id, customerUserId: regular.id, lastMessageAt: daysAgo(4) },
    select: { id: true },
  });
  await prisma.customerMessage.create({
    data: { threadId: regularThread.id, side: "STORE", authorUserId: owner.id, body: "Спасибо за покупку!", createdAt: daysAgo(4) },
  });

  const promo = await prisma.merchantPromo.create({
    data: {
      companyId: company.id, title: `${TAG} вернитесь к нам`, body: "Минус десять процентов на чай до конца недели.",
      startsAt: daysAgo(1), endsAt: daysAgo(-6), productId: tea.id, pointId: point.id,
    },
    select: { id: true },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_mkt`, `${TAG}_keeper`],
        tokens: { owner: owner.token, marketer: marketer.token, keeper: keeper.token },
        ids: {
          company: company.id, point: point.id, promo: promo.id, tea: tea.id,
          regular: regular.id, dormantFollower: dormantFollower.id, dormantOff: dormantOff.id,
          newcomer: newcomer.id, follower: follower.id, talker: talker.id,
        },
        expect: {
          buyers: "4 / reachable 2",
          regulars: "1 / 1",
          newcomers: "1 / 1",
          dormant: "2 / 0",
          followersNoPurchase: "1 / 1",
          talkers: "1 / 0",
          anonymousSales: 1,
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
