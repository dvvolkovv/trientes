-- AlterTable
ALTER TABLE "Exchange" ADD COLUMN "marketsFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExchangeMarket" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "baseSymbol" TEXT NOT NULL,
    "quoteSymbol" TEXT NOT NULL,
    "baseCurrencyId" TEXT,
    "quoteCurrencyId" TEXT,
    "category" TEXT,
    "priceUsd" DOUBLE PRECISION,
    "volumeUsd24h" DOUBLE PRECISION,
    "volumeSharePct" DOUBLE PRECISION,
    "outlier" BOOLEAN NOT NULL DEFAULT false,
    "marketUrl" TEXT,
    "lastTradedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeMarket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeMarket_exchangeId_volumeUsd24h_idx" ON "ExchangeMarket"("exchangeId", "volumeUsd24h" DESC);

-- CreateIndex
CREATE INDEX "ExchangeMarket_exchangeId_firstSeenAt_idx" ON "ExchangeMarket"("exchangeId", "firstSeenAt" DESC);

-- CreateIndex
CREATE INDEX "ExchangeMarket_exchangeId_lastSeenAt_idx" ON "ExchangeMarket"("exchangeId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "ExchangeMarket" ADD CONSTRAINT "ExchangeMarket_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
