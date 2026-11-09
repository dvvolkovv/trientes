// Ночной отчёт здоровья руками: `npx tsx scripts/health-report.ts` — напечатать,
// `--send` — ещё и отправить в Telegram тем, кому его шлёт воркер.
import { config } from "dotenv";
config();

import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { healthChatIds, sendHealthReport } from "../src/lib/health-report";

async function main() {
  const send = process.argv.includes("--send");
  const r = await sendHealthReport({ prisma: prisma as never, redis: redis as never, chatIds: send ? undefined : [] });
  console.log(r.text);
  if (send) console.log(`\nотправлено: ${r.sent.join(", ") || "никому"}${r.failed.length ? `; не ушло: ${r.failed.map((f) => `${f.chatId} (${f.reason})`).join(", ")}` : ""}`);
  else console.log(`\n(не отправлено; адресаты: ${healthChatIds().join(", ") || "никого"} — добавьте --send)`);
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
