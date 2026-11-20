-- Слайс BN: режим работы, вид заведения, политика возврата (ТЗ § 3.1).
-- Все поля свободные: модерация к ним не прикасается, поэтому ни статусов, ни
-- индексов под очередь здесь нет.

ALTER TABLE "Company" ADD COLUMN "category" TEXT;
ALTER TABLE "Company" ADD COLUMN "returnPolicy" TEXT;
ALTER TABLE "Company" ADD COLUMN "returnDays" INTEGER;

ALTER TABLE "CompanyPoint" ADD COLUMN "hours" JSONB;
ALTER TABLE "CompanyPoint" ADD COLUMN "timezone" TEXT;
ALTER TABLE "CompanyPoint" ADD COLUMN "category" TEXT;
