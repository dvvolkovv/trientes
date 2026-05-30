-- Phase 10 / Slice 7: Fintech Directory.
-- New FintechCompany model (curated + self-registered), two enums (FintechService,
-- FintechKyc), and five new AdminAction values. Mirrors RegisteredExchange for
-- self-registration (ownerUserId @unique) and Exchange for the source distinction.

ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'APPROVE_FINTECH';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'REJECT_FINTECH';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'EDIT_FINTECH';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'CREATE_FINTECH';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'DELETE_FINTECH';

DO $$ BEGIN
  CREATE TYPE "FintechService" AS ENUM (
    'CARD','IBAN','SEPA','SWIFT','SAVINGS','CRYPTO_LOANS',
    'STAKING','EXCHANGE','CUSTODY','PAYMENTS','ONRAMP','OFFRAMP'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FintechKyc" AS ENUM ('NONE','BASIC','FULL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "FintechCompany" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "description" TEXT,
    "website" TEXT NOT NULL,
    "socials" JSONB,
    "foundedYear" INTEGER,

    "countryCode" TEXT,
    "city" TEXT,
    "address" TEXT,
    "hqLat" DOUBLE PRECISION,
    "hqLon" DOUBLE PRECISION,

    "services" "FintechService"[] DEFAULT ARRAY[]::"FintechService"[],
    "supportedCoinIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedFiats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availableIn" TEXT[] DEFAULT ARRAY[]::TEXT[],

    "kycLevel" "FintechKyc",
    "feesSummary" TEXT,
    "appStoreUrl" TEXT,
    "playStoreUrl" TEXT,

    "source" TEXT NOT NULL DEFAULT 'curated',
    "ownerUserId" TEXT,

    "status" "RequestStatus" NOT NULL DEFAULT 'APPROVED',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FintechCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FintechCompany_slug_key" ON "FintechCompany"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "FintechCompany_ownerUserId_key" ON "FintechCompany"("ownerUserId");
CREATE INDEX IF NOT EXISTS "FintechCompany_status_displayName_idx" ON "FintechCompany"("status", "displayName");
CREATE INDEX IF NOT EXISTS "FintechCompany_source_idx" ON "FintechCompany"("source");

ALTER TABLE "FintechCompany"
  ADD CONSTRAINT "FintechCompany_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FintechCompany"
  ADD CONSTRAINT "FintechCompany_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
