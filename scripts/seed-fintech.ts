import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { CURATED_FINTECH, logoForDomain } from "@/lib/curated-fintech";

// Upserts the curated fintech list into FintechCompany. Idempotent: re-running
// updates fields in place. Status is always APPROVED + source=curated so they
// show up on /fintech immediately, ahead of user-submitted rows.
//
// Usage: tsx scripts/seed-fintech.ts

async function main() {
  let created = 0;
  let updated = 0;
  for (const row of CURATED_FINTECH) {
    const logoUrl = row.logoUrl ?? logoForDomain(row.website);
    const data = {
      slug: row.slug,
      displayName: row.displayName,
      legalName: row.legalName ?? null,
      logoUrl,
      description: row.description,
      website: row.website,
      foundedYear: row.foundedYear,
      countryCode: row.countryCode,
      services: row.services,
      supportedCoinIds: row.supportedCoinIds,
      supportedFiats: row.supportedFiats,
      availableIn: row.availableIn,
      kycLevel: row.kycLevel,
      appStoreUrl: row.appStoreUrl ?? null,
      playStoreUrl: row.playStoreUrl ?? null,
      source: "curated",
      status: "APPROVED" as const,
    };
    const existing = await prisma.fintechCompany.findUnique({ where: { slug: row.slug } });
    if (existing) {
      await prisma.fintechCompany.update({ where: { slug: row.slug }, data });
      updated++;
    } else {
      await prisma.fintechCompany.create({ data });
      created++;
    }
  }
  console.log(`fintech seed ok: ${created} created, ${updated} updated, ${CURATED_FINTECH.length} total in curated list.`);
}

main()
  .catch((err) => {
    console.error("seed-fintech failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
