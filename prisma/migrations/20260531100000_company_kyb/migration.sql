CREATE TYPE "KybStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Company"
  ADD COLUMN "kybStatus" "KybStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "kybDocuments" JSONB,
  ADD COLUMN "kybSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "kybReviewedAt" TIMESTAMP(3),
  ADD COLUMN "kybRejectionReason" TEXT;

CREATE INDEX "Company_kybStatus_idx" ON "Company"("kybStatus");
