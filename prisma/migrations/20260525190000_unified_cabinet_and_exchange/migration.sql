-- Drop User.accountType (was: INDIVIDUAL | COMPANY)
ALTER TABLE "User" DROP COLUMN "accountType";
DROP TYPE "AccountType";

-- Allow a user to own multiple companies
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_ownerUserId_key";
CREATE INDEX "Company_ownerUserId_idx" ON "Company"("ownerUserId");

-- Registered-exchange status enum
-- NOTE: The existing "Exchange" table/model is the CoinGecko exchange catalog and is untouched.
-- User-submitted exchange registrations live in "RegisteredExchange" to avoid collision.
CREATE TYPE "ExchangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- RegisteredExchange table (user-submitted exchanges awaiting admin moderation)
CREATE TABLE "RegisteredExchange" (
  "id"              TEXT NOT NULL,
  "ownerUserId"     TEXT NOT NULL,
  "legalName"       TEXT NOT NULL,
  "displayName"     TEXT NOT NULL,
  "logoUrl"         TEXT,
  "description"     TEXT,
  "website"         TEXT NOT NULL,
  "country"         TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "phone"           TEXT,
  "address"         TEXT,
  "socials"         JSONB,
  "status"          "ExchangeStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RegisteredExchange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegisteredExchange_ownerUserId_idx" ON "RegisteredExchange"("ownerUserId");
CREATE INDEX "RegisteredExchange_status_createdAt_idx" ON "RegisteredExchange"("status", "createdAt");

ALTER TABLE "RegisteredExchange"
  ADD CONSTRAINT "RegisteredExchange_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Admin audit actions for exchange moderation
ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_EXCHANGE';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_EXCHANGE';
