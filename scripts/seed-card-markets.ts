import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ALL_CEX_IDS, getSnapshots } from "@/lib/cex-snapshot";
import { computeAnchorPrices, syncCardMarkets } from "@/lib/coin-card-markets";
import { seedCardMarkets, type CardPlan } from "@/lib/coin-card-market-seed";

/**
 * Посев рынков карточек, проверенных в сети (слайс X).
 *
 *   tsx scripts/seed-card-markets.ts --dump   показать, что нашлось, без записи
 *   tsx scripts/seed-card-markets.ts          завести рынки и сразу сверить их
 *   tsx scripts/seed-card-markets.ts --card=<id|slug>   одна карточка
 *
 * Без флага прогон после посева зовёт сверку слайса C, иначе индекс появится
 * только через десять минут, и глазами проверить нечего.
 */

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const cardArg = args.find((a) => a.startsWith("--card="))?.split("=")[1];

function line(plan: CardPlan): string {
  const { result } = plan;
  const ref = plan.referenceUsd == null ? "—" : plan.referenceUsd.toPrecision(6);
  const head = `${plan.slug.padEnd(30)} ${plan.symbol.padEnd(6)} опора ${ref.padStart(12)}`;
  if (result.error) return `${head}  ${result.error}${result.rejected.length ? `, отвергнуто ${result.rejected.join(" ")}` : ""}`;
  const pairs = result.markets.map((m) => `${m.exchangeId}:${m.pair}@${m.priceUsd.toPrecision(6)}`);
  const tail = result.rejected.length ? `  | отвергнуто ${result.rejected.join(" ")}` : "";
  return `${head}  ${pairs.join(" ")}${tail}`;
}

async function main(): Promise<void> {
  let cardId = cardArg;
  if (cardArg) {
    const card = await prisma.coinCard.findFirst({
      where: { OR: [{ id: cardArg }, { slug: cardArg }] },
      select: { id: true },
    });
    if (!card) {
      console.error(`нет карточки ${cardArg}`);
      process.exit(1);
    }
    cardId = card.id;
  }

  const snapshots = await getSnapshots(ALL_CEX_IDS, { redis: redis as never });
  const anchors = computeAnchorPrices(snapshots);
  const unreachable = [...snapshots.values()].filter((s) => "error" in s).map((s) => s.id);
  if (unreachable.length) console.error(`биржи не ответили: ${unreachable.join(", ")}`);
  console.log(`опорные монеты: ${Object.entries(anchors).map(([k, v]) => `${k}=${v?.toPrecision(6)}`).join(" ")}`);

  const { stats, plans } = await seedCardMarkets({
    prisma: prisma as never,
    snapshots,
    anchors,
    cardId,
    dryRun: has("--dump"),
  });

  for (const plan of plans) console.log(line(plan));
  console.log(
    `\nкарточек ${stats.cards}, рынков заведено ${stats.created}, ` +
      `без опоры ${stats.noReference}, без пар ${stats.noPairs}, ` +
      `спор о цене ${stats.conflict}, отвергнуто ${stats.rejected}`,
  );

  if (!has("--dump") && stats.created > 0) {
    const s = await syncCardMarkets({ prisma: prisma as never, redis: redis as never });
    console.log(
      `сверка: ${s.cards} карточек, ${s.marketsChecked} рынков ` +
        `(${s.confirmed} подтверждено, ${s.failed} отказ), ${s.indexed} с индексом`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
