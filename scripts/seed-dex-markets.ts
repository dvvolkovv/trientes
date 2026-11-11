import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { syncCardMarkets } from "@/lib/coin-card-markets";
import {
  readOwnDexMarket,
  syncOwnDexMarkets,
  type PrismaLike,
} from "@/lib/coin-card-dex-market";
import { readSwapRegistry, readPairPrice } from "@/lib/trientes-dex";

/**
 * Рынки нашего собственного обмена в карточках монет.
 *
 *   tsx scripts/seed-dex-markets.ts --dump   показать реестр обмена и цены, без записи
 *   tsx scripts/seed-dex-markets.ts          записать рынки и сразу пересчитать индекс
 *   tsx scripts/seed-dex-markets.ts --card=<id>   одна карточка
 *
 * Без флага прогон после записи зовёт сверку слайса C: иначе индекс появится
 * только со следующим часовым прогоном и глазами проверить нечего.
 */

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const cardArg = args.find((a) => a.startsWith("--card="))?.split("=")[1];

async function dump(): Promise<void> {
  const registry = await readSwapRegistry();
  if ("error" in registry) {
    console.error("реестр обмена не прочитан:", registry.error);
    return;
  }
  console.log(
    `Реестр обмена: тикеров ${registry.tickers.length}, монет ${registry.coins.length}, пар ${registry.pairs.length}`,
  );
  console.log("");
  for (const p of registry.pairs) {
    const base = registry.coins.find((c) => c.ticker === p.base);
    const quote = registry.coins.find((c) => c.ticker === p.quote);
    if (!base || !quote) continue;
    const r = await readPairPrice(registry, base.symbol, quote.symbol);
    const name = `${base.symbol}/${quote.symbol}`.padEnd(12);
    if ("error" in r) {
      console.log(`${name} отказ: ${r.error}`);
      continue;
    }
    console.log(
      `${name} ${r.price.toPrecision(8).padStart(16)}  спред ${r.spreadPct.toFixed(2)}%  наценка ${r.markupPct}%`,
    );
  }

  console.log("");
  const cards = await prisma.coinCard.findMany({
    where: { status: "APPROVED" },
    select: { id: true, slug: true, symbol: true },
  });
  for (const card of cards) {
    const r = await readOwnDexMarket(card);
    if (r.error) continue;
    console.log(
      `карточка ${card.slug.padEnd(24)} ${r.fact.pair.padEnd(12)} ${
        r.fact.priceUsd == null ? "без цены (нет стейбловой пары)" : `${r.fact.priceUsd.toPrecision(8)} USD`
      }`,
    );
  }
}

async function main(): Promise<void> {
  if (has("--dump")) {
    await dump();
    return;
  }
  // Срез полей у прогона свой — Prisma-клиент шире его PrismaLike.
  const stats = await syncOwnDexMarkets({
    prisma: prisma as unknown as PrismaLike,
    cardId: cardArg,
  });
  console.log("записано рынков:", stats.written, "сбоев:", stats.failed, stats.errors);
  const sync = await syncCardMarkets({
    prisma: prisma as never,
    redis: redis as never,
    cardId: cardArg,
  });
  console.log("сверка:", sync);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
