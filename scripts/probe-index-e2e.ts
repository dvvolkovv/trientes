// Разовая сквозная проверка слайса C на живых биржах: временная карточка с
// заявленными рынками, прогон, вывод, удаление. В базе ничего не остаётся.
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "../src/lib/prisma";
import { syncCardMarkets } from "../src/lib/coin-card-markets";

async function main() {
  const card = await prisma.coinCard.create({
    data: {
      slug: `e2e-index-probe-${Date.now()}`,
      name: "Index probe",
      symbol: "BTC",
      status: "PENDING",
      markets: {
        create: [
          { kind: "CEX", exchangeName: "Binance", pair: "BTC/USDT" },
          { kind: "CEX", exchangeName: "Kraken", pair: "BTC/USD" },
          { kind: "CEX", exchangeName: "Gate.io", pair: "BTC/USDT" },
          { kind: "CEX", exchangeName: "Coinbase", pair: "BTC/USD" },
          { kind: "CEX", exchangeName: "Binance", pair: "BTC/NOPE" },
          { kind: "CEX", exchangeName: "SomeUnknownExchange", pair: "BTC/USDT" },
          { kind: "CEX", exchangeName: "Binance", pair: "ETH/USDT" },
          { kind: "DEX", exchangeName: "Uniswap V3", pair: "BTC/WETH" },
        ],
      },
    },
  });

  try {
    const stats = await syncCardMarkets({ prisma: prisma as never, cardId: card.id });
    console.log("stats:", stats);

    const idx = await prisma.coinCardPriceIndex.findUnique({ where: { cardId: card.id } });
    console.log("индекс:", idx);
    const points = await prisma.coinCardPricePoint.findMany({ where: { cardId: card.id } });
    console.log("точек истории:", points.length, points[0]?.at.toISOString());
    const fresh = await prisma.coinCard.findUnique({ where: { id: card.id }, select: { provenance: true } });
    console.log("провенанс:", JSON.stringify(fresh?.provenance));

    for (const m of await prisma.coinCardMarket.findMany({ where: { cardId: card.id }, orderBy: { exchangeName: "asc" } })) {
      console.log(
        `${m.exchangeName.padEnd(20)} ${m.pair.padEnd(10)} price=${m.priceUsd ?? "—"} vol=${
          m.volumeUsd24h?.toFixed(0) ?? "—"
        } 24h=${m.change24h?.toFixed(2) ?? "—"} err=${m.checkError ?? "—"} conf=${m.confirmedAt ? "да" : "нет"}${
          m.isOutlier ? " выброс" : ""
        }`,
      );
    }
  } finally {
    await prisma.coinCard.delete({ where: { id: card.id } });
    console.log("временная карточка удалена");
    await prisma.$disconnect();
  }
}
void main();
