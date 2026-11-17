// Лестница эскалации жалоб на точки руками: `npx tsx scripts/point-report-sweep.ts`.
import { config } from "dotenv";
config();

import { prisma } from "../src/lib/prisma";
import { runPointReportSweep } from "../src/lib/points/report-sweep";

async function main() {
  const stats = await runPointReportSweep();
  console.log(JSON.stringify(stats));
  await prisma.$disconnect();
}

void main();
