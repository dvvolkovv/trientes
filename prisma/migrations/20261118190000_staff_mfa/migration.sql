-- Второй фактор входа для сотрудников (слайс BA).
-- Миграция писана руками и применяется `migrate deploy`: этот чекаут — прод,
-- а `migrate dev` умеет предлагать сброс базы.

ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_MFA_ENABLED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_MFA_DISABLED';

DO $$ BEGIN
  CREATE TYPE "MfaKind" AS ENUM ('TOTP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "mfaAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "StaffMfa" (
  "userId" TEXT NOT NULL,
  "kind" "MfaKind" NOT NULL DEFAULT 'TOTP',
  "secretEnc" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "lastStep" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  "disabledById" TEXT,
  "disabledReason" TEXT,
  CONSTRAINT "StaffMfa_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "StaffMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "StaffMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StaffMfaRecoveryCode_userId_idx" ON "StaffMfaRecoveryCode"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "StaffMfaRecoveryCode_userId_codeHash_key" ON "StaffMfaRecoveryCode"("userId", "codeHash");

DO $$ BEGIN
  ALTER TABLE "StaffMfa" ADD CONSTRAINT "StaffMfa_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StaffMfa" ADD CONSTRAINT "StaffMfa_disabledById_fkey"
    FOREIGN KEY ("disabledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StaffMfaRecoveryCode" ADD CONSTRAINT "StaffMfaRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "StaffMfa"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
