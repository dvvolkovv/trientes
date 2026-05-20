-- CreateTable
CREATE TABLE "Exchange" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "country" TEXT,
    "yearEstablished" INTEGER,
    "trustScore" INTEGER,
    "trustScoreRank" INTEGER,
    "volume24hBtc" DOUBLE PRECISION NOT NULL,
    "volume24hUsd" DOUBLE PRECISION NOT NULL,
    "url" TEXT,
    "hasTradingIncentive" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exchange_trustScoreRank_idx" ON "Exchange"("trustScoreRank");
