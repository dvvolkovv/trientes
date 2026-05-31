-- AlertOp enum
CREATE TYPE "AlertOp" AS ENUM ('GTE', 'LTE');

-- User opt-in fields for notification channels
ALTER TABLE "User"
  ADD COLUMN "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT false;

-- PriceAlert table
CREATE TABLE "PriceAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "coinId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "op" "AlertOp" NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "triggered" BOOLEAN NOT NULL DEFAULT false,
  "lastFiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceAlert_userId_enabled_idx" ON "PriceAlert"("userId", "enabled");
CREATE INDEX "PriceAlert_enabled_coinId_idx" ON "PriceAlert"("enabled", "coinId");

ALTER TABLE "PriceAlert"
  ADD CONSTRAINT "PriceAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
