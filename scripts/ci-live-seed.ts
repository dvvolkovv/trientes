/**
 * Живой прогон слайса CI: временные объекты под заявку письмом с домена.
 *
 * Заводится карточка монеты с сайтом на домене `trientes.org` и финтех-запись
 * на том же домене — чтобы письмо, пришедшее с него, нашло сразу две цели (так
 * бывает у настоящего проекта: `crypto.com` это и монета, и сервис). Всё
 * убирается `ci-live-clean.ts`.
 */
import { prisma } from "../src/lib/prisma";

const DOMAIN = process.env.CI_LIVE_DOMAIN ?? "trientes.org";

async function main() {
  const card = await prisma.coinCard.create({
    data: {
      slug: "ci-live-card",
      name: "CI Live Coin",
      symbol: "CILIVE",
      status: "APPROVED",
      trust: "UNVERIFIED",
      links: { website: `https://${DOMAIN}` },
    },
    select: { id: true, slug: true },
  });

  const fintech = await prisma.fintechCompany.create({
    data: {
      slug: "ci-live-fintech",
      displayName: "CI Live Fintech",
      website: `https://www.${DOMAIN}`,
      status: "APPROVED",
      source: "curated",
      services: [],
    },
    select: { id: true, slug: true },
  });

  // Занятая цель: её видно в деле, но передать этой дверью нельзя.
  const owner = await prisma.user.create({
    data: { username: "ci-live-owner", name: "CI Live Owner", role: "USER" },
    select: { id: true },
  });
  const taken = await prisma.fintechCompany.create({
    data: {
      slug: "ci-live-fintech-owned",
      displayName: "CI Live Fintech (owned)",
      website: `https://${DOMAIN}`,
      status: "APPROVED",
      source: "curated",
      services: [],
      ownerUserId: owner.id,
    },
    select: { id: true },
  });

  // Тот, кто пройдёт по ссылке приглашения.
  const claimant = await prisma.user.create({
    data: { username: "ci-live-claimant", name: "CI Live Claimant", role: "USER" },
    select: { id: true },
  });

  console.log(JSON.stringify({ card, fintech, taken, owner, claimant, domain: DOMAIN }, null, 2));
}

main().finally(() => prisma.$disconnect());
