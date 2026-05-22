import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { fetchMarketsByIds } from "@/lib/coingecko";
import { syncAdminAddedPrices } from "@/lib/sync/orchestrator";

// Adds a coin via the same ADMIN_ADDED path the admin panel uses, then runs the
// admin-added price sync once so price/logo/rank populate immediately instead of
// waiting for the worker's next :05/:35 cron tick.
//
// Usage: tsx scripts/add-coin.ts --id dash --symbol DASH --name Dash

function parseArgs(argv: string[]): { id?: string; symbol?: string; name?: string } {
  const out: { id?: string; symbol?: string; name?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id") out.id = argv[++i];
    else if (a === "--symbol") out.symbol = argv[++i];
    else if (a === "--name") out.name = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = (args.id ?? "").trim().toLowerCase();
  const symbol = (args.symbol ?? "").trim().toUpperCase();
  const name = (args.name ?? "").trim();

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("invalid --id (CoinGecko id)");
  if (!symbol || symbol.length > 12) throw new Error("invalid --symbol");
  if (!name) throw new Error("invalid --name");

  const existing = await prisma.coin.findUnique({ where: { id } });
  if (existing) {
    console.log(`Coin "${id}" already exists (source=${existing.source}, active=${existing.isActive}) — skipping create.`);
  } else {
    await prisma.coin.create({
      data: { id, symbol, name, slug: id, rank: 9999, source: "ADMIN_ADDED", isActive: true },
    });
    console.log(`Created ADMIN_ADDED coin "${id}" (${symbol} — ${name}).`);
  }

  // Mirror worker/index.ts runAdminAddedSync — populate price/logo/rank now.
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  const { count } = await syncAdminAddedPrices({
    listAdminAddedIds: async () => {
      const rows = await prisma.coin.findMany({
        where: { source: "ADMIN_ADDED", isActive: true },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
    fetchByIds: fetchMarketsByIds,
    redis: redis as never,
    prisma: prisma as never,
  });
  console.log(`admin-added price sync ok: ${count} coin(s) priced.`);

  const fresh = await prisma.coin.findUnique({
    where: { id },
    select: { rank: true, logoUrl: true },
  });
  console.log(`"${id}" now: rank=${fresh?.rank}, logo=${fresh?.logoUrl ? "set" : "none"}.`);
}

main()
  .catch((err) => {
    console.error("add-coin failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
