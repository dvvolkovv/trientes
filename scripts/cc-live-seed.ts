/**
 * Посев живого прогона слайса CC (реклама через модератора). Снимает `cc-live-clean.ts`.
 *   npx tsx scripts/cc-live-seed.ts
 */
import { randomBytes } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { sealSecret } from "../src/lib/mfa/secret-store";

const TAG = "cclive";
const PASSWORD = "cc-live-pass-2311";
const SRC = "/var/www/trientes-uploads/points/cmwm2jtfr0009d7fcink72rv7/ada437967cb96e6ef5fb27ed.jpg";
const ROOT = process.env.AD_MEDIA_ROOT ?? "/var/www/trientes-uploads/ads";

/**
 * Сотруднику второй фактор обязателен (слайс BA), иначе любая страница админки
 * уводит его на заведение. В прогоне ключ заводим сами и помечаем сеанс
 * показавшим код — проверяется тут не фактор, а очередь рекламы.
 */
async function passMfa(userId: string, token: string) {
  await prisma.staffMfa.create({
    data: { userId, kind: "TOTP", secretEnc: sealSecret(randomBytes(20)), confirmedAt: new Date() },
  });
  await prisma.session.update({ where: { sessionToken: token }, data: { mfaAt: new Date() } });
}

async function mkUser(suffix: string, name: string, hash: string, role: "USER" | "OWNER" = "USER") {
  const user = await prisma.user.create({
    data: {
      username: `${TAG}_${suffix}`, name, role, passwordHash: hash, preferredLocale: "ru",
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
  const owner = await mkUser("owner", "CC live merchant", hash);
  // Модератор-сотрудник: право только на очередь рекламы — проверяем заодно, что
  // чужие очереди ему не видны (мотив AS).
  const mod = await mkUser("mod", "CC live ad moderator", hash);
  await prisma.user.update({ where: { id: mod.id }, data: { role: "STAFF" } });
  await prisma.staffMember.create({
    data: { userId: mod.id, title: "Ad moderator", accessReviewAt: new Date(Date.now() + 180 * 864e5) },
  });
  await prisma.staffGrant.create({ data: { userId: mod.id, queue: "ads", level: "APPROVE" } });
  await passMfa(mod.id, mod.token);

  // Второй модератор: правило четырёх глаз требует **двух живых людей**, и тот,
  // кто проверял, утвердить не вправе (AP).
  const mod2 = await mkUser("mod2", "CC live ad approver", hash);
  await prisma.user.update({ where: { id: mod2.id }, data: { role: "STAFF" } });
  await prisma.staffMember.create({
    data: { userId: mod2.id, title: "Ad approver", accessReviewAt: new Date(Date.now() + 180 * 864e5) },
  });
  await prisma.staffGrant.create({ data: { userId: mod2.id, queue: "ads", level: "APPROVE" } });
  await passMfa(mod2.id, mod2.token);

  const company = await prisma.company.create({
    data: {
      ownerUserId: owner.id, legalName: `${TAG} s.r.o.`, displayName: `${TAG} shop`, status: "APPROVED",
      countryCode: "CZ", country: "Czechia", city: "Prague", street: "Dlouhá", houseNumber: "12",
      postalCode: "11000", address: "Dlouhá 12, 11000 Prague, Czechia", phone: "+420 123 456 789",
      email: `${TAG}@example.org`, website: "https://example.org", registrationNumber: "12345678",
      kybStatus: "APPROVED", description: "Временное предприятие живого прогона CC.",
    },
    select: { id: true },
  });
  await prisma.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: "OWNER" } });

  const dir = join(ROOT, company.id);
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(16).toString("hex")}.jpg`;
  await copyFile(SRC, join(dir, name));
  const mediaUrl = `/uploads/ads/${company.id}/${name}`;

  const ad = await prisma.companyAd.create({
    data: {
      companyId: company.id, kind: "PROMO", title: "Скидка на кофе всю неделю", language: "ru",
      body: "Вторая чашка в подарок тем, кто платит монетой.", mediaKind: "IMAGE", mediaUrl,
      promoCode: "COFFEE-CC", status: "DRAFT", action: "NONE", createdById: owner.id,
    },
    select: { id: true },
  });

  console.log(JSON.stringify({
    owner: owner.id, ownerToken: owner.token, mod: mod.id, modToken: mod.token,
    mod2: mod2.id, mod2Token: mod2.token,
    company: company.id, ad: ad.id, mediaUrl,
  }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
