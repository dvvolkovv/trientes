/**
 * Уборка живого прогона слайса CP (приём платежей в карточке магазина).
 *
 * Прогон шёл в **отдельной схеме** базы (`?schema=cp_preview`), а не в проде: слайс не
 * выложен, миграция в прод не применена, и трогать живые предприятия ради снимков
 * нельзя. Поэтому уборка — это снос схемы целиком, а не удаление строк по одной: ни
 * одна запись прогона не живёт за её пределами.
 *
 * Запуск: `npx tsx scripts/cp-live-clean.ts` (схема берётся из `CP_SCHEMA`,
 * по умолчанию `cp_preview`; база — из `DATABASE_URL` без параметра схемы).
 */
import { PrismaClient } from "@prisma/client";

const schema = process.env.CP_SCHEMA ?? "cp_preview";

if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error(`имя схемы не годится: ${schema}`);
  process.exit(1);
}
if (schema === "public") {
  console.error("public — это прод; уборка прогона её не трогает");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ schema_name: string }[]>(
    `select schema_name from information_schema.schemata where schema_name = $1`,
    schema,
  );
  if (rows.length === 0) {
    console.log(`схемы ${schema} нет — убирать нечего`);
    return;
  }
  await prisma.$executeRawUnsafe(`drop schema "${schema}" cascade`);
  console.log(`схема ${schema} снесена`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
