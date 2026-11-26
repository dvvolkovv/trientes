/**
 * Посев временных данных для живого прогона слайса CO (правила «если — то» и исходящие
 * оповещения). Снимает `co-live-clean.ts`.
 *
 *   npx tsx scripts/co-live-seed.ts
 *
 * Своё предприятие: чужих правил и чужих оповещений прогон не трогает. Нужны кассир (он
 * проводит продажу, от которой рождается событие), кладовщик без права на автоматизацию
 * (он должен получить 404) и полка с двумя единицами товара — чтобы одна продажа
 * пересекла порог, а вторая уже нет.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "../src/lib/merchant-api/keys";

const TAG = "colive";
const PASSWORD = "co-live-pass-4412";

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
  const owner = await mkUser("owner", "CO live owner", hash);
  const keeper = await mkUser("keeper", "CO live keeper", hash);

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} s.r.o.`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "CZ",
      country: "Czechia",
      city: "Prague",
      address: "Dlouhá 16, 11000 Prague, Czechia",
      description: "Временное предприятие живого прогона CO.",
      category: "grocery",
      timezone: "Europe/Prague",
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id, type: "SHOP", name: `${TAG} точка`, status: "APPROVED",
      lat: 50.0885, lon: 14.4225, countryCode: "CZ", city: "Prague",
      address: "Dlouhá 16, Prague", timezone: "Europe/Prague",
    },
    select: { id: true },
  });

  // Кладовщик: склад и товар есть, автоматизации нет вовсе — раздела он видеть не
  // должен, а по прямой ссылке получить 404 (запрет по умолчанию).
  const keeperRole = await prisma.companyTeamRole.create({
    data: {
      companyId: company.id,
      name: `${TAG} кладовщик`,
      permissions: { warehouses: "EDIT", products: "VIEW", tasks: "VIEW", sales: "EDIT" },
    },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: keeper.id, role: "VIEWER", roleId: keeperRole.id },
  });

  const tea = await prisma.product.create({
    data: {
      slug: `${TAG}-tea`,
      name: `${TAG} чай`,
      category: "food",
      language: "ru",
      description: "Временный товар живого прогона CO.",
    },
    select: { id: true },
  });
  const shelf = await prisma.warehouse.create({
    data: { companyId: company.id, name: `${TAG} полка`, kind: "SHELF", pointId: point.id },
    select: { id: true },
  });
  await prisma.productOffer.create({
    data: { companyId: company.id, productId: tea.id, price: 600, currency: "EUR", unit: "pcs", status: "ACTIVE" },
  });
  // Полка наполняется **приходом**, а не строкой баланса: иначе сверка
  // `scripts/stock-audit.ts` увидит товар, появившийся из воздуха (находка CK).
  await prisma.stockMovement.create({
    data: {
      companyId: company.id, productId: tea.id, kind: "RECEIPT", status: "DONE",
      toWarehouseId: shelf.id, qty: 2, createdById: owner.id,
    },
  });
  await prisma.stockBalance.create({ data: { warehouseId: shelf.id, productId: tea.id, qty: 2 } });

  // Порог автозаказа: по нему считается «кончается» — второго места для порога нет.
  // Поставщик у правила обязателен (BI: правило без адресата — сигнал, а сигналов мы
  // не шлём), поэтому заводится и он.
  const supplier = await prisma.supplier.create({
    data: { companyId: company.id, name: `${TAG} поставщик`, email: "supplier@example.org" },
    select: { id: true },
  });
  await prisma.reorderRule.create({
    data: {
      company: { connect: { id: company.id } },
      warehouse: { connect: { id: shelf.id } },
      product: { connect: { id: tea.id } },
      supplier: { connect: { id: supplier.id } },
      minQty: 1,
      targetQty: 10,
    },
  });

  const key = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      companyId: company.id,
      name: `${TAG} внешняя система`,
      prefix: apiKeyPrefix(key),
      keyHash: hashApiKey(key),
      createdById: owner.id,
    },
  });

  console.log(
    JSON.stringify(
      {
        companyId: company.id,
        pointId: point.id,
        shelfId: shelf.id,
        productId: tea.id,
        owner: { id: owner.id, token: owner.token, username: `${TAG}_owner` },
        keeper: { id: keeper.id, token: keeper.token, username: `${TAG}_keeper` },
        apiKey: key,
        password: PASSWORD,
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
