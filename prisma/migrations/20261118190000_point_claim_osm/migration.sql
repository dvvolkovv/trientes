-- Точка зеркала BTC Map, забранная предприятием себе. Ключ тот же, что у
-- OsmCryptoPoi.id ("node:123"): после одобрения фид прячет зеркальную точку,
-- иначе одно заведение стояло бы на карте двумя булавками.
ALTER TABLE "CompanyPoint" ADD COLUMN "osmId" TEXT;

CREATE INDEX "CompanyPoint_osmId_idx" ON "CompanyPoint"("osmId");
