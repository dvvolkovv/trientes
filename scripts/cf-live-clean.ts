/** Уборка за живым прогоном CF: сносит всё, что завёл `cf-live-seed.ts`. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { adMediaRoot } from "../src/lib/ads/media-files";

const TAG = "cflive";

async function main() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: `${TAG}_` } },
    select: { id: true },
  });
  const companies = await prisma.company.findMany({
    where: { displayName: { startsWith: `${TAG} ` } },
    select: { id: true },
  });
  for (const c of companies) {
    await prisma.companyAd.deleteMany({ where: { companyId: c.id } });
    await prisma.company.delete({ where: { id: c.id } });
    // Файлы кадров сносит и сам `deleteAd`, но прогон мог оборваться на середине:
    // каталог временного предприятия целиком наш, и после него оставаться нечему.
    await rm(join(adMediaRoot(), c.id), { recursive: true, force: true }).catch(() => {});
  }
  // Строки аудита — **до** записей людей: у `actorId` стоит `ON DELETE RESTRICT`,
  // и решение модератора прогона иначе блокирует удаление (цена, уже всплывавшая
  // в уборке AU).
  const ids = users.map((u) => u.id);
  const audit = await prisma.adminAuditLog.deleteMany({ where: { actorId: { in: ids } } });
  for (const u of users) await prisma.user.delete({ where: { id: u.id } });
  console.log(`строк аудита убрано: ${audit.count}`);
  console.log(`убрано: предприятий ${companies.length}, записей ${users.length}`);
}

main().finally(() => prisma.$disconnect());
