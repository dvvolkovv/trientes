-- Слайс E: циркулирующий выпуск считается из сети, капитализация — по
-- индексной цене. Миграция аддитивная: ни одно существующее поле не меняется.
CREATE TABLE "CoinCardSupply" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  "totalSupply" TEXT NOT NULL,
  "excludedTotal" TEXT NOT NULL,
  "circulating" TEXT NOT NULL,
  "excluded" JSONB NOT NULL,
  "partial" BOOLEAN NOT NULL DEFAULT false,
  "claimedDeltaPct" DOUBLE PRECISION,
  "method" TEXT NOT NULL DEFAULT 'ONCHAIN_V1',
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "checkError" TEXT,
  CONSTRAINT "CoinCardSupply_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoinCardSupply_cardId_key" ON "CoinCardSupply"("cardId");
CREATE INDEX "CoinCardSupply_checkedAt_idx" ON "CoinCardSupply"("checkedAt");
ALTER TABLE "CoinCardSupply"
  ADD CONSTRAINT "CoinCardSupply_cardId_fkey" FOREIGN KEY ("cardId")
  REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoinCardPriceIndex"
  ADD COLUMN "marketCapUsd" DOUBLE PRECISION,
  ADD COLUMN "fdvUsd" DOUBLE PRECISION,
  ADD COLUMN "supplySource" TEXT;
