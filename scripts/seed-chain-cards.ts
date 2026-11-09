import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { chainFamily, plannedCard, SEED_CARDS } from "@/lib/coin-card-seed";
import { syncChainFacts } from "@/lib/coin-card-chain-facts";
import { syncCardSupply } from "@/lib/coin-card-supply";

/**
 * Посев карточек, проверяемых в сети (слайс V).
 *
 * Четыре шага, каждый отдельным запуском, потому что между ними нужно
 * посмотреть глазами:
 *
 *   tsx scripts/seed-chain-cards.ts            посев в PENDING (идемпотентно)
 *   tsx scripts/seed-chain-cards.ts --fill     прочитать сеть по каждой карточке
 *   tsx scripts/seed-chain-cards.ts --dump     показать прочитанное таблицей
 *   tsx scripts/seed-chain-cards.ts --publish  опубликовать те, где всё сошлось
 *
 * Фильтр по семье: `--family=SUBSTRATE` или `--family=COSMOS`.
 */

type Family = "SUBSTRATE" | "COSMOS";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const familyArg = args.find((a) => a.startsWith("--family="))?.split("=")[1] as Family | undefined;

const rows = SEED_CARDS.filter((r) => !familyArg || chainFamily(r.chain) === familyArg);

async function seed(): Promise<void> {
  let created = 0;
  let exists = 0;
  let missing = 0;
  for (const row of rows) {
    const coin = await prisma.coin.findUnique({
      where: { id: row.coinId },
      select: { id: true, slug: true, name: true, symbol: true },
    });
    if (!coin) {
      console.error(`  нет монеты ${row.coinId} — пропуск`);
      missing++;
      continue;
    }
    const already = await prisma.coinCard.findFirst({
      where: { OR: [{ coinId: coin.id }, { slug: coin.slug }] },
      select: { id: true, slug: true, nativeChain: true },
    });
    // Существующую карточку не трогаем вовсе: у неё может быть куратор и
    // заявления проекта, которые посев не вправе переписывать.
    if (already) {
      console.log(`  ${coin.slug}: карточка уже есть (${already.nativeChain ?? "без сети"})`);
      exists++;
      continue;
    }
    const card = plannedCard(coin, row.chain, new Date());
    await prisma.coinCard.create({
      data: {
        slug: card.slug,
        coinId: card.coinId,
        name: card.name,
        symbol: card.symbol,
        nativeChain: card.nativeChain,
        status: card.status,
        trust: card.trust,
        provenance: card.provenance,
      },
    });
    console.log(`  ${coin.slug}: посеяна на сети ${row.chain}`);
    created++;
  }
  console.log(`посев: ${created} создано, ${exists} уже было, ${missing} без монеты`);
}

/** Прогоны по одной карточке: они умеют это в обход статуса PENDING. */
async function fill(): Promise<void> {
  for (const card of await seededCards()) {
    const facts = await syncChainFacts({ prisma: prisma as never, cardId: card.id });
    const supply = await syncCardSupply({ prisma: prisma as never, cardId: card.id });
    console.log(
      `  ${card.slug}: факты ${facts.ok ? "ok" : "сбой"}, выпуск ` +
        `${supply.ok ? "ok" : supply.partial ? "частично" : "сбой"}`,
    );
  }
}

async function dump(): Promise<void> {
  for (const card of await seededCards()) {
    const f = card.chainFacts;
    const s = card.supply;
    console.log(`\n── ${card.symbol} (${card.slug}) · ${card.nativeChain} · ${card.status}`);
    if (!f) console.log("   фактов сети нет");
    else
      console.log(
        `   сеть: ${f.tokenSymbol ?? "?"} ${f.tokenDecimals ?? "?"} знаков · ` +
          `блок ${f.blockSeconds ?? "?"} с · финализация −${f.finalityLag ?? "?"} ` +
          `(${f.finalitySeconds ?? "?"} с) · комиссия ` +
          `${f.transferFeeTokens ?? f.transferFeeError ?? "?"} · ` +
          `расхождения [${f.mismatches.join(", ")}]${f.checkError ? ` · ОШИБКА ${f.checkError}` : ""}`,
      );
    if (!s) console.log("   выпуска нет");
    else
      console.log(
        `   выпуск: ${s.totalSupply} (оборот ${s.circulating})` +
          `${s.checkError ? ` · ОШИБКА ${s.checkError}` : ""}`,
      );
  }
}

async function publish(): Promise<void> {
  let published = 0;
  let held = 0;
  for (const card of await seededCards()) {
    if (card.status === "APPROVED") continue;
    const ready =
      card.chainFacts &&
      !card.chainFacts.checkError &&
      card.supply &&
      !card.supply.checkError &&
      card.chainFacts.mismatches.length === 0;
    if (!ready) {
      console.log(`  ${card.slug}: держим скрытой — факты не сошлись`);
      held++;
      continue;
    }
    await prisma.coinCard.update({ where: { id: card.id }, data: { status: "APPROVED" } });
    console.log(`  ${card.slug}: опубликована`);
    published++;
  }
  console.log(`публикация: ${published} открыто, ${held} осталось скрытыми`);
}

function seededCards() {
  return prisma.coinCard.findMany({
    where: { nativeChain: { in: rows.map((r) => r.chain) } },
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      symbol: true,
      status: true,
      nativeChain: true,
      chainFacts: true,
      supply: true,
    },
  });
}

async function main(): Promise<void> {
  if (has("--fill")) await fill();
  else if (has("--dump")) await dump();
  else if (has("--publish")) await publish();
  else await seed();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
