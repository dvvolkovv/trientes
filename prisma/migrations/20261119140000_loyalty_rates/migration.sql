-- Слайс BD: ставки кэшбэка «на всё» и по категориям.
-- Спека: docs/superpowers/specs/2026-11-19-loyalty-rates-levels-design.md

ALTER TABLE "Company" ADD COLUMN "cashbackBasePercent" DECIMAL(5,2);

CREATE TABLE "CashbackRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashbackRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashbackRule_companyId_idx" ON "CashbackRule"("companyId");
CREATE UNIQUE INDEX "CashbackRule_companyId_category_key" ON "CashbackRule"("companyId", "category");

ALTER TABLE "CashbackRule" ADD CONSTRAINT "CashbackRule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
