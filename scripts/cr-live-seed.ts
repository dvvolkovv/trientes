/**
 * Посев временных данных для живого прогона слайса CR (криптоучёт мерчанта, ТЗ 6.8).
 * Снимает `cr-live-clean.ts`.
 *
 *   npx tsx scripts/cr-live-seed.ts
 *
 * Своё предприятие: живых мерчантов прогон не трогает. Нужны сразу все состояния книги —
 * два крипто-чека с разными курсами (один сходится с нашей ценой, другой нарочно в десять
 * раз ниже), отменённый чек, адрес с проверенным форматом и адрес незаведённый, а главное
 * — **настоящий адрес из санкционного списка OFAC**, чтобы пометка проверялась на живых
 * данных, а не на выдуманной строке.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { addressKey } from "../src/lib/crypto-ledger/address";

const TAG = "crlive";
const PASSWORD = "cr-live-pass-4218";

/** Настоящий segwit-адрес Bitcoin (контрольная сумма сходится). */
const OWN_BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
/** Адрес, которого в книге адресов нет: экран обязан сказать «чей он?». */
const STRANGE_BTC = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
/** Тикер без известной нам семьи: формат честно «не проверен». */
const USDT_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

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
  const owner = await mkUser("owner", "CR live owner", hash);
  const accountant = await mkUser("acc", "CR live accountant", hash);
  const keeper = await mkUser("keeper", "CR live keeper", hash);

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
      description: "Временное предприятие живого прогона CR.",
      category: "grocery",
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

  // Бухгалтер: отчётность целиком, кассы нет — книгу он ведёт, чек пробить не может.
  const accRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} бухгалтер`,
      permissions: { card: "VIEW", products: "VIEW", reports: "EDIT" },
    },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: accountant.id, role: "VIEWER", roleId: accRole.id },
  });
  // Кладовщик: ни отчётности, ни книги — плитки он не увидит, страница отдаст 404.
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
    data: { companyId: company.id, productId: tea.id, price: 100, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });
  await prisma.stockMovement.create({
    data: {
      companyId: company.id, productId: tea.id, toWarehouseId: shelf.id, kind: "RECEIPT",
      status: "DONE", qty: 50, createdById: owner.id,
    },
  });
  await prisma.stockBalance.create({
    data: { warehouseId: shelf.id, productId: tea.id, qty: 50 },
  });

  let number = 0;
  const sale = async (opts: {
    at: Date;
    total: number;
    coin: string;
    rate: number;
    coinAmount: number;
    address: string | null;
    txHash: string | null;
    cancelled?: boolean;
  }) => {
    number += 1;
    const row = await prisma.sale.create({
      data: {
        companyId: company.id,
        number,
        warehouseId: shelf.id,
        pointId: point.id,
        currency: "EUR",
        listTotal: opts.total,
        total: opts.total,
        cashbackTotal: 0,
        payment: "CRYPTO",
        payCoin: opts.coin,
        payRate: opts.rate,
        payCoinAmount: opts.coinAmount,
        payAddress: opts.address,
        payTxHash: opts.txHash,
        status: opts.cancelled ? "CANCELLED" : "COMPLETED",
        cancelReason: opts.cancelled ? "покупатель передумал" : null,
        cancelledAt: opts.cancelled ? opts.at : null,
        createdById: owner.id,
        createdAt: opts.at,
        lines: {
          create: [
            {
              productId: tea.id, name: `${TAG} чай`, unit: "pcs", qty: 1,
              listPrice: opts.total, price: opts.total, cashbackPercent: null, cashbackAmount: 0,
            },
          ],
        },
      },
      select: { id: true, number: true },
    });
    return row;
  };

  // Курс «сходится» берём от **нашей живой цены** монеты, а не выдумываем: иначе
  // прогон проверял бы не сверку, а нашу фантазию. Евро к доллару ≈ 1,09.
  const btcSnap = await prisma.coinSnapshot.findFirst({
    where: { coin: { symbol: { equals: "btc", mode: "insensitive" } } },
    orderBy: { fetchedAt: "desc" },
    select: { priceUsd: true },
  });
  const btcUsd = btcSnap ? Number(btcSnap.priceUsd) : 60_000;
  const marketRateEur = Math.round(btcUsd / 1.09);

  const ok = await sale({
    at: daysAgo(3), total: Math.round(marketRateEur / 100), coin: "BTC", rate: marketRateEur, coinAmount: 0.01,
    address: OWN_BTC, txHash: `0x${"ab".repeat(32)}`,
  });
  // Курс вдесятеро ниже: сверка обязана назвать расхождение, но чек не отвергать.
  const off = await sale({
    at: daysAgo(2), total: 900, coin: "BTC", rate: Math.round(marketRateEur / 10), coinAmount: 0.1,
    address: STRANGE_BTC, txHash: null,
  });
  // Отменённый чек приходом не считается, но назван своим числом.
  const cancelled = await sale({
    at: daysAgo(1), total: 500, coin: "BTC", rate: 100_000, coinAmount: 0.005,
    address: OWN_BTC, txHash: null, cancelled: true,
  });
  // Вторая монета без известной нам семьи: формат адреса честно не проверяется.
  const usdt = await sale({
    at: daysAgo(1, 15), total: 200, coin: "USDT", rate: 0.92, coinAmount: 217.39,
    address: USDT_ADDRESS, txHash: null,
  });
  await prisma.company.update({ where: { id: company.id }, data: { saleSeq: number } });

  // Адреса книги: свой (проверенный формат) и второй под USDT (формат не проверен).
  await prisma.companyCryptoAddress.createMany({
    data: [
      {
        companyId: company.id, coin: "BTC", address: OWN_BTC, addressKey: addressKey(OWN_BTC),
        family: "BITCOIN", label: "Касса, segwit", createdById: owner.id,
      },
      {
        companyId: company.id, coin: "USDT", address: USDT_ADDRESS, addressKey: addressKey(USDT_ADDRESS),
        family: null, label: "USDT на EVM", createdById: owner.id,
      },
    ],
  });

  // Две операции: конвертация по курсу выше среднего (курсовая разница положительная) и
  // вывод без курса (в разницу не идёт вовсе).
  await prisma.companyCryptoOperation.createMany({
    data: [
      {
        companyId: company.id, kind: "CONVERSION", coin: "BTC", amount: 0.05,
        rate: Math.round(marketRateEur * 1.05),
        currency: "EUR", fiatAmount: Math.round(marketRateEur * 1.05 * 0.05),
        happenedAt: daysAgo(1), note: "Продано на бирже", createdById: accountant.id,
      },
      {
        companyId: company.id, kind: "WITHDRAWAL", coin: "BTC", amount: 0.01, rate: null,
        currency: "EUR", fiatAmount: null, happenedAt: daysAgo(1, 16),
        address: OWN_BTC, note: "Перевод на свой холодный кошелёк", createdById: owner.id,
      },
    ],
  });

  // Санкционный адрес — настоящий, из той же выборки, что читает прогон. Берём первую
  // строку списка: пометка должна проверяться на живых данных.
  const listed = await prisma.sanctionedCryptoAddress.findFirst({
    where: { asset: "XBT" },
    select: { address: true, listedName: true },
  });
  if (listed) {
    await prisma.companyCryptoAddress.create({
      data: {
        companyId: company.id, coin: "BTC", address: listed.address, addressKey: addressKey(listed.address),
        family: "BITCOIN", label: "Адрес из списка (прогон)", createdById: owner.id,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_acc`, `${TAG}_keeper`],
        tokens: { owner: owner.token, accountant: accountant.token, keeper: keeper.token },
        ids: { company: company.id, point: point.id, shelf: shelf.id, tea: tea.id, teaSlug: tea.slug },
        sales: { ok: ok.number, off: off.number, cancelled: cancelled.number, usdt: usdt.number },
        marketRateEur,
        sanctioned: listed?.address ?? null,
        sanctionedName: listed?.listedName ?? null,
        expect: {
          btcReceived: 0.11,
          btcBalance: 0.05,
          avgRateEur: "взвешенный по двум чекам",
          fxDiff: "положительная по конвертации 0,05 BTC",
          unknownAddress: STRANGE_BTC,
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
