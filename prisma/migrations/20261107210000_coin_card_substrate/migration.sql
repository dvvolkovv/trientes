ALTER TABLE "CoinCard" ADD COLUMN "nativeChain" TEXT;

CREATE TABLE "CoinCardChainFacts" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "genesisHash" TEXT NOT NULL,
    "tokenSymbol" TEXT,
    "tokenDecimals" INTEGER,
    "ss58Format" INTEGER,
    "blockSeconds" DOUBLE PRECISION,
    "blockSample" INTEGER,
    "bestNumber" INTEGER,
    "finalizedNumber" INTEGER,
    "finalityLag" INTEGER,
    "finalitySeconds" DOUBLE PRECISION,
    "mismatches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "checkError" TEXT,

    CONSTRAINT "CoinCardChainFacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoinCardChainFacts_cardId_key" ON "CoinCardChainFacts"("cardId");
CREATE INDEX "CoinCardChainFacts_checkedAt_idx" ON "CoinCardChainFacts"("checkedAt");

ALTER TABLE "CoinCardChainFacts" ADD CONSTRAINT "CoinCardChainFacts_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
