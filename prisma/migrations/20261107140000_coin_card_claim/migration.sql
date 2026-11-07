-- Слайс D: проект доказывает контроль над монетой машинно проверяемым
-- способом, и владение карточкой переходит к нему без участия админа.
CREATE TYPE "ClaimMethod" AS ENUM ('OWNER_SIGNATURE', 'DNS_TXT', 'WELL_KNOWN');
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "CoinCardClaim" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "claimantId" TEXT NOT NULL,
  "method" "ClaimMethod" NOT NULL,
  "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
  "token" TEXT NOT NULL,
  "target" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastTriedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoinCardClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoinCardClaim_token_key" ON "CoinCardClaim"("token");
CREATE INDEX "CoinCardClaim_cardId_status_idx" ON "CoinCardClaim"("cardId", "status");
CREATE INDEX "CoinCardClaim_claimantId_createdAt_idx" ON "CoinCardClaim"("claimantId", "createdAt");
ALTER TABLE "CoinCardClaim"
  ADD CONSTRAINT "CoinCardClaim_cardId_fkey" FOREIGN KEY ("cardId")
  REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoinCardClaim"
  ADD CONSTRAINT "CoinCardClaim_claimantId_fkey" FOREIGN KEY ("claimantId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
