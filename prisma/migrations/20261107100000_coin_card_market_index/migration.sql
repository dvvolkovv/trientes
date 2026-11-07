-- Слайс C: собственный агрегатор рынков.
-- Результат сверки заявленного листинга с публичным API биржи ложится рядом с
-- заявлением, а не вместо него (тот же принцип, что в слайсе B для контрактов).
ALTER TABLE "CoinCardMarket"
  ADD COLUMN "nativeSymbol" TEXT,
  ADD COLUMN "quote" TEXT,
  ADD COLUMN "change24h" DOUBLE PRECISION,
  ADD COLUMN "isOutlier" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checkedAt" TIMESTAMP(3),
  ADD COLUMN "checkError" TEXT;

-- Индекс карточки: вычисленное значение со своей методикой и временем.
CREATE TABLE "CoinCardPriceIndex" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "priceUsd" DOUBLE PRECISION NOT NULL,
  "change24h" DOUBLE PRECISION,
  "volumeUsd24h" DOUBLE PRECISION NOT NULL,
  "marketCount" INTEGER NOT NULL,
  "spreadPct" DOUBLE PRECISION,
  "confidence" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'VWMEDIAN_V1',
  "computedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoinCardPriceIndex_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoinCardPriceIndex_cardId_key" ON "CoinCardPriceIndex"("cardId");
ALTER TABLE "CoinCardPriceIndex"
  ADD CONSTRAINT "CoinCardPriceIndex_cardId_fkey" FOREIGN KEY ("cardId")
  REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Часовая история: график будет позже, но историю нельзя добрать потом.
CREATE TABLE "CoinCardPricePoint" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "priceUsd" DOUBLE PRECISION NOT NULL,
  "volumeUsd24h" DOUBLE PRECISION NOT NULL,
  "marketCount" INTEGER NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoinCardPricePoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoinCardPricePoint_cardId_at_key" ON "CoinCardPricePoint"("cardId", "at");
CREATE INDEX "CoinCardPricePoint_cardId_at_idx" ON "CoinCardPricePoint"("cardId", "at");
ALTER TABLE "CoinCardPricePoint"
  ADD CONSTRAINT "CoinCardPricePoint_cardId_fkey" FOREIGN KEY ("cardId")
  REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
