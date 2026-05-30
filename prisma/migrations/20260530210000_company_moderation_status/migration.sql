-- Owner-visible moderation status on Company (parallel to RegisteredExchange).
-- Existing companies are grandfathered as APPROVED so live owners aren't suddenly
-- shown as 'pending'; new registrations default to PENDING.

ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'APPROVE_COMPANY';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'REJECT_COMPANY';

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

-- Grandfather rows that existed before this migration: they were already in use,
-- treat them as approved. New inserts will use the column default (PENDING).
UPDATE "Company" SET "status" = 'APPROVED' WHERE "status" = 'PENDING';

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Company_status_createdAt_idx" ON "Company"("status", "createdAt");
