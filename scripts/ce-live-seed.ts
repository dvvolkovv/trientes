/**
 * Посев для живого прогона слайса CE: кадры внутри одного материала.
 * Снимает `ce-live-clean.ts`.
 *
 *   npx tsx scripts/ce-live-seed.ts
 *
 * Живые предприятия в прогоне только читаются: завести у чужого материал ради
 * проверки нельзя.
 */
import { randomBytes } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

const TAG = "celive";
const PASSWORD = "ce-live-pass-8812";
const ROOT = process.env.AD_MEDIA_ROOT ?? "/var/www/trientes-uploads/ads";
/// Кадры одолжены у живых файлов: карусель должна показать настоящие растры.
const SOURCES = [
  "/var/www/trientes-uploads/points/cmwm2jtfr0009d7fcink72rv7/ada437967cb96e6ef5fb27ed.jpg",
  "/var/www/trientes-uploads/companies/cmwm2jtfr0009d7fcink72rv7/2ed6458a4be1e1af4a9832a2.jpg",
];

async function main() {
  const hash = await hashPassword(PASSWORD);
  const owner = await prisma.user.create({
    data: {
      username: `${TAG}_owner`,
      name: "CE live owner",
      role: "USER",
      passwordHash: hash,
      preferredLocale: "ru",
      accounts: { create: { provider: "credentials", providerAccountId: `${TAG}_owner`, type: "credentials" } },
    },
    select: { id: true },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken: token, userId: owner.id, expires: new Date(Date.now() + 864e5) },
  });

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id,
      legalName: `${TAG} s.r.o.`,
      displayName: `${TAG} slides`,
      status: "APPROVED",
      countryCode: "CZ",
      country: "Czechia",
      city: "Praha",
      street: "Dlouhá",
      houseNumber: "12",
      address: "Dlouhá 12, Praha, Czechia",
      email: `${TAG}@example.org`,
      logoUrl: SOURCES[1].replace("/var/www/trientes-uploads", "/uploads"),
      description: "Временное предприятие живого прогона CE.",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
    select: { id: true },
  });

  // Пять кадров в одном материале: ровно то, чего не давала форма до слайса.
  const dir = join(ROOT, company.id);
  await mkdir(dir, { recursive: true });
  const slides: { kind: string; url: string; posterUrl: string | null }[] = [];
  for (let i = 0; i < 5; i += 1) {
    const name = `${randomBytes(16).toString("hex")}.jpg`;
    await copyFile(SOURCES[i % SOURCES.length], join(dir, name));
    slides.push({ kind: "IMAGE", url: `/uploads/ads/${company.id}/${name}`, posterUrl: null });
  }

  const ad = await prisma.companyAd.create({
    data: {
      companyId: company.id,
      kind: "PROMO",
      title: "Пять кадров одним материалом",
      body: "Временный материал живого прогона CE.",
      language: "ru",
      // Обложка — первый кадр: её выводит разбор формы, тут ставим так же.
      mediaKind: "IMAGE",
      mediaUrl: slides[0].url,
      slides,
      status: "PUBLISHED",
      submittedAt: new Date(),
      decidedAt: new Date(),
      promoCode: "CE-5",
    },
    select: { id: true },
  });

  // Второй материал черновиком: ради правки и счёта мест.
  const draft = await prisma.companyAd.create({
    data: {
      companyId: company.id,
      kind: "NEWS",
      title: "Черновик на один кадр",
      language: "ru",
      mediaKind: "IMAGE",
      mediaUrl: slides[0].url,
      status: "DRAFT",
    },
    select: { id: true },
  });

  console.log(JSON.stringify({
    owner: owner.id, token, company: company.id, ad: ad.id, draft: draft.id, password: PASSWORD,
  }));
}

main().finally(() => prisma.$disconnect());
