-- Карточка монеты для реального сектора, слайс F.
-- Миграция строго аддитивная и покрывает все четыре подслайса (F1-F4), чтобы
-- не плодить вторую: только ADD COLUMN / CREATE INDEX / ALTER TYPE ADD VALUE.
-- Поля payments/legal и значение PAYMENTS создаются заранее и в F1 не читаются.

-- AlterEnum
ALTER TYPE "CoinCardSection" ADD VALUE 'PAYMENTS';

-- AlterTable: связь точки приёма с собственным листингом (F1)
ALTER TABLE "CompanyPoint" ADD COLUMN "acceptedCardIds" TEXT[];

-- AlterTable: связь финтех-сервиса с собственным листингом (F3)
ALTER TABLE "FintechCompany" ADD COLUMN "supportedCardIds" TEXT[];

-- AlterTable: платёжный профиль (F2) и правовой статус (F4)
ALTER TABLE "CoinCard" ADD COLUMN "payments" JSONB,
                       ADD COLUMN "legal" JSONB;

-- CreateIndex
CREATE INDEX "CompanyPoint_acceptedCardIds_idx" ON "CompanyPoint" USING GIN ("acceptedCardIds");
CREATE INDEX "FintechCompany_supportedCardIds_idx" ON "FintechCompany" USING GIN ("supportedCardIds");
