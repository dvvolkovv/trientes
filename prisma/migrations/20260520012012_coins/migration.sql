-- CreateEnum
CREATE TYPE "CoinSource" AS ENUM ('AUTO_L1', 'ADMIN_ADDED');

-- CreateTable
CREATE TABLE "Coin" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "source" "CoinSource" NOT NULL DEFAULT 'AUTO_L1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinSnapshot" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "priceUsd" DECIMAL(24,10) NOT NULL,
    "marketCapUsd" DECIMAL(30,2) NOT NULL,
    "volume24hUsd" DECIMAL(30,2) NOT NULL,
    "pctChange1h" DOUBLE PRECISION,
    "pctChange24h" DOUBLE PRECISION,
    "pctChange7d" DOUBLE PRECISION,
    "circulatingSupply" DECIMAL(30,2),
    "totalSupply" DECIMAL(30,2),
    "maxSupply" DECIMAL(30,2),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalStats" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "totalMarketCapUsd" DECIMAL(30,2) NOT NULL,
    "total24hVolumeUsd" DECIMAL(30,2) NOT NULL,
    "btcDominancePct" DOUBLE PRECISION NOT NULL,
    "ethDominancePct" DOUBLE PRECISION NOT NULL,
    "activeCryptos" INTEGER NOT NULL,
    "markets" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coin_slug_key" ON "Coin"("slug");

-- CreateIndex
CREATE INDEX "CoinSnapshot_coinId_fetchedAt_idx" ON "CoinSnapshot"("coinId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "CoinSnapshot" ADD CONSTRAINT "CoinSnapshot_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
