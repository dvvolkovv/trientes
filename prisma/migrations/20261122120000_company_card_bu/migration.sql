-- Слайс BU: карточка предприятия — логотип (форма и вписывание), отрасль,
-- часы конторы, настройка публичности и публичные документы.
--
-- Писано руками и применяется `migrate deploy`: этот чекаут — прод, а
-- `migrate dev` умеет предлагать сброс базы.

ALTER TABLE "Company"
  ADD COLUMN "logoShape" TEXT,
  ADD COLUMN "logoFit" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "industryCustom" TEXT,
  ADD COLUMN "hours" JSONB,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "publicFields" JSONB;

CREATE TABLE "CompanyDocument" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT,
  "url" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyDocument_companyId_publishedAt_idx"
  ON "CompanyDocument"("companyId", "publishedAt");

ALTER TABLE "CompanyDocument"
  ADD CONSTRAINT "CompanyDocument_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyDocument"
  ADD CONSTRAINT "CompanyDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
