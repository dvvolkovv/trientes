/**
 * Посев временных данных для живого прогона слайса BC. Временно: всё, что он создаёт,
 * снимает `scripts/bc-live-clean.ts` по тому же префиксу.
 *
 *   npx tsx scripts/bc-live-seed.ts
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";

const TAG = "bc-live";

async function main() {
  const user = await prisma.user.create({
    data: { username: `${TAG}-owner`, name: "BC live owner", role: "USER" },
    select: { id: true },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: user.id,
      legalName: `${TAG} GmbH`,
      displayName: `${TAG} shop`,
      status: "APPROVED",
      countryCode: "AT",
      city: "Vienna",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    select: { id: true },
  });

  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: `${TAG} corner shop`,
      status: "APPROVED",
      lat: 48.2082,
      lon: 16.3738,
      countryCode: "AT",
      city: "Vienna",
      address: "Stephansplatz 1",
      acceptedCoinIds: [],
      acceptedCardIds: [],
    },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      slug: `${TAG}-water`,
      name: "BC live spring water 0.5 l",
      category: "food",
      language: "en",
      description:
        "Temporary passport for the BC slice live run: spring water in a half-litre bottle. Created by a script and removed by the companion cleanup script.",
      createdByCompanyId: company.id,
    },
    select: { id: true, slug: true },
  });

  // Сеанс в базе — тот же механизм, которым живёт вход: страницу кабинета надо открыть
  // настоящим браузером, иначе прогон проверяет не экран, а наши же функции.
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId: user.id,
      expires: new Date(Date.now() + 2 * 3600_000),
    },
  });

  console.log(
    JSON.stringify(
      { userId: user.id, companyId: company.id, pointId: point.id, productId: product.id, slug: product.slug, token },
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
