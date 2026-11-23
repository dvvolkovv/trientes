-- Документы рекламного материала (слайс CB). Таблица одна с бумагами предприятия:
-- поля, рубрики, корень файлов и правила у них те же.
ALTER TABLE "CompanyDocument" ADD COLUMN "adId" TEXT;

ALTER TABLE "CompanyDocument"
  ADD CONSTRAINT "CompanyDocument_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "CompanyAd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CompanyDocument_adId_publishedAt_idx" ON "CompanyDocument"("adId", "publishedAt");
