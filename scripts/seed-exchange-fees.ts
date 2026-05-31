import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { CURATED_EXCHANGE_FEES } from "@/lib/curated-exchange-fees";

// Updates fee columns on Exchange rows for each curated entry. Skips rows that
// don't exist (the upstream CoinGecko sync hasn't pulled them yet). Idempotent.
// Usage: tsx scripts/seed-exchange-fees.ts

async function main() {
  let updated = 0;
  let missing = 0;
  for (const f of CURATED_EXCHANGE_FEES) {
    const exists = await prisma.exchange.findUnique({ where: { id: f.id }, select: { id: true } });
    if (!exists) { missing++; continue; }
    await prisma.exchange.update({
      where: { id: f.id },
      data: {
        makerFeePercent: f.makerFeePercent,
        takerFeePercent: f.takerFeePercent,
        feesNote: f.feesNote,
        feesUrl: f.feesUrl,
      },
    });
    updated++;
  }
  console.log(`exchange-fees seed ok: ${updated} updated, ${missing} not in DB.`);
}

main()
  .catch((err) => { console.error("seed-exchange-fees failed:", err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
