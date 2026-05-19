import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";

async function main() {
  console.log("[worker] starting…");
  await prisma.$queryRaw`SELECT 1`;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  await redis.ping();
  console.log("[worker] connections ok. Phase 1 stub running, no jobs scheduled yet.");

  const tick = setInterval(() => {
    console.log(`[worker] alive ${new Date().toISOString()}`);
  }, 60_000);

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
    clearInterval(tick);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
