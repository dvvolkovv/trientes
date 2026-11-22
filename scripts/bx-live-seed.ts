/**
 * Посев временных данных для живого прогона слайса BX (карточка предприятия —
 * одна витрина, одни выключатели, наследование часов и монет). Снимает
 * `bx-live-clean.ts`.
 *
 *   npx tsx scripts/bx-live-seed.ts
 *
 * Живой Arcon в прогоне только читается: менять монеты и выключатели чужого
 * предприятия ради проверки нельзя, поэтому всё, что правится, — своё.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "bxlive";
const PASSWORD = "bx-live-pass-4417";
/// Логотип одолжен у живого предприятия: файл только читается, а плитке
/// подписок нужен настоящий растр, чтобы проверять её вид.
const LOGO = "/uploads/companies/cmwm2jtfr0009d7fcink72rv7/2ed6458a4be1e1af4a9832a2.jpg";

const WEEK = {
  mon: { kind: "open", spans: [["09:00", "18:00"]] },
  tue: { kind: "open", spans: [["09:00", "18:00"]] },
  wed: { kind: "open", spans: [["09:00", "18:00"]] },
  thu: { kind: "open", spans: [["09:00", "18:00"]] },
  fri: { kind: "open", spans: [["09:00", "18:00"]] },
  sat: { kind: "open", spans: [["10:00", "14:00"]] },
  sun: { kind: "closed" },
};

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
  const owner = await mkUser("owner", "BX live owner", hash);
  const editor = await mkUser("editor", "BX live card editor", hash);
  const viewer = await mkUser("viewer", "BX live card viewer", hash);
  const follower = await mkUser("follower", "BX live follower", hash);

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
      website: "https://example.org",
      logoUrl: LOGO,
      description: "Временное предприятие живого прогона BX.",
      category: "grocery",
      registrationNumber: "CZ-12345678",
      taxNumber: "CZ99999999",
      returnDays: 14,
      returnPolicy: "Возврат в течение 14 дней с чеком.",
      // Часы и монеты заданы предприятию, у точки пусто — это и есть наследование.
      hours: WEEK,
      timezone: "Europe/Prague",
      acceptedCoinIds: ["bitcoin", "ethereum"],
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true },
  });

  // Две свои роли: право на карточку (EDIT) и только чтение (VIEW). Обе ставятся
  // на базовую роль VIEWER — чтобы снос роли понижал, а не повышал (правило BE).
  const editRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: `${TAG} карточка`, permissions: { card: "EDIT", points: "VIEW" } },
    select: { id: true },
  });
  const viewRole = await prisma.companyTeamRole.create({
    data: { companyId: company.id, name: `${TAG} наблюдатель`, permissions: { card: "VIEW", points: "VIEW" } },
    select: { id: true },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: editor.id, role: "VIEWER", roleId: editRole.id },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: viewer.id, role: "VIEWER", roleId: viewRole.id },
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

  await prisma.companyFollow.create({ data: { userId: follower.id, companyId: company.id } });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        logins: [`${TAG}_owner`, `${TAG}_editor`, `${TAG}_viewer`, `${TAG}_follower`],
        tokens: { owner: owner.token, editor: editor.token, viewer: viewer.token, follower: follower.token },
        ids: { company: company.id, point: point.id, product: product.id, productSlug: product.slug },
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
