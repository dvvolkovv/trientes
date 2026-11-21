/**
 * Разовое слияние двойных строк каталога бирж.
 *
 * Правило поиска и доводы — в `src/lib/exchange-dedupe.ts`; карта псевдонимов,
 * которая не даст двойнику завестись заново, — `CP_TO_CG_ALIAS` в
 * `src/lib/coinpaprika.ts`. Карту надо заполнить **до** слияния: иначе
 * ближайший прогон CoinPaprika заведёт удалённую строку снова.
 *
 *   npx tsx scripts/merge-exchange-dupes.ts            # план, ничего не меняет
 *   npx tsx scripts/merge-exchange-dupes.ts --apply    # слить
 *
 * Что делает слияние: переносит на главную строку рынки (`ExchangeMarket` —
 * ключ переписывается, потому что он составной) и закладки, дозаполняет пустые
 * поля главной значениями двойника, удаляет двойника. Что НЕ делает: не
 * затирает заполненное у главной (автор значения один) и не удаляет строку,
 * которой в карте псевдонимов нет, — о такой просто говорит вслух.
 */
import { prisma } from "../src/lib/prisma";
import { findExchangeDupes, remapMarketId, type DedupeRow } from "../src/lib/exchange-dedupe";
import { CP_TO_CG_ALIAS } from "../src/lib/coinpaprika";

/** Поля, которые дозаполняются у главной строки, если у неё пусто. */
const FILLABLE = [
  "logoUrl", "country", "yearEstablished", "trustScore", "trustScoreRank", "url",
  "description", "exchangeType", "currencies", "pairsCount", "socials",
  "makerFeePercent", "takerFeePercent", "feesNote", "feesUrl", "marketsFetchedAt",
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.exchange.findMany({ select: { id: true, name: true, source: true } });
  const { groups, refused } = findExchangeDupes(rows as DedupeRow[]);

  console.log(`строк каталога: ${rows.length}; групп двойников: ${groups.length}; отказов: ${refused.length}`);
  for (const r of refused) {
    console.log(`  ОТКАЗ ${r.key} (${r.reason}): ${r.rows.map((x) => `${x.id}/${x.source}`).join(", ")}`);
  }

  let merged = 0, movedMarkets = 0, droppedMarkets = 0, movedWatchers = 0, filled = 0, unaliased = 0;

  for (const g of groups) {
    for (const loser of g.merged) {
      // Строка, которой нет в карте псевдонимов, вернулась бы следующим
      // прогоном: удалять её значит делать работу, которую тут же отменят.
      if (CP_TO_CG_ALIAS[loser.id] !== g.canonical.id) {
        console.log(`  ПРОПУСК ${loser.id} → ${g.canonical.id}: нет записи в CP_TO_CG_ALIAS`);
        unaliased++;
        continue;
      }

      const [winnerRow, loserRow, markets, watchers] = await Promise.all([
        prisma.exchange.findUnique({ where: { id: g.canonical.id } }),
        prisma.exchange.findUnique({ where: { id: loser.id } }),
        prisma.exchangeMarket.findMany({ where: { exchangeId: loser.id }, select: { id: true } }),
        prisma.exchangeWatchlist.findMany({ where: { exchangeId: loser.id }, select: { userId: true } }),
      ]);
      if (!winnerRow || !loserRow) continue;

      const fill: Record<string, unknown> = {};
      for (const f of FILLABLE) {
        const w = (winnerRow as Record<string, unknown>)[f];
        const l = (loserRow as Record<string, unknown>)[f];
        if ((w === null || w === undefined) && l !== null && l !== undefined) fill[f] = l;
      }

      console.log(
        `  ${loser.id} → ${g.canonical.id} (${g.canonical.name}): рынков ${markets.length}, закладок ${watchers.length}` +
          (Object.keys(fill).length ? `, дозаполнить ${Object.keys(fill).join(",")}` : ""),
      );
      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        for (const m of markets) {
          const nextId = remapMarketId(m.id, loser.id, g.canonical.id);
          if (!nextId) continue;
          const clash = await tx.exchangeMarket.findUnique({ where: { id: nextId }, select: { id: true } });
          if (clash) {
            // Та же пара уже есть у главной — она и остаётся: цена и объём у неё
            // от последнего прогона, а не от двойника.
            await tx.exchangeMarket.delete({ where: { id: m.id } });
            droppedMarkets++;
          } else {
            await tx.exchangeMarket.update({ where: { id: m.id }, data: { id: nextId, exchangeId: g.canonical.id } });
            movedMarkets++;
          }
        }
        for (const w of watchers) {
          const clash = await tx.exchangeWatchlist.findUnique({
            where: { userId_exchangeId: { userId: w.userId, exchangeId: g.canonical.id } },
            select: { userId: true },
          });
          if (!clash) {
            await tx.exchangeWatchlist.update({
              where: { userId_exchangeId: { userId: w.userId, exchangeId: loser.id } },
              data: { exchangeId: g.canonical.id },
            });
            movedWatchers++;
          }
        }
        if (Object.keys(fill).length > 0) {
          await tx.exchange.update({ where: { id: g.canonical.id }, data: fill });
          filled++;
        }
        await tx.exchange.delete({ where: { id: loser.id } });
      });
      merged++;
    }
  }

  console.log(
    apply
      ? `слито ${merged}; рынков перенесено ${movedMarkets}, отброшено как уже бывшие ${droppedMarkets}; закладок ${movedWatchers}; строк дозаполнено ${filled}; пропущено без псевдонима ${unaliased}`
      : `план: слить ${groups.reduce((n, g) => n + g.merged.length, 0)} строк (без псевдонима ${unaliased}); ничего не изменено — добавьте --apply`,
  );
}

void main().finally(() => prisma.$disconnect());
