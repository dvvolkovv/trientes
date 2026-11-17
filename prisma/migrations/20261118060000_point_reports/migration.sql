CREATE TYPE "PointReportReason" AS ENUM ('CLOSED', 'NO_CRYPTO', 'WRONG_ADDRESS', 'OTHER');

ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_REPORTED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_ASKED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_WARNED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_SUSPENDED';
ALTER TYPE "AdminNotificationKind" ADD VALUE 'POINT_REPORTED';

ALTER TABLE "CompanyPoint"
  ADD COLUMN "underReviewAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendReason" TEXT;

CREATE INDEX "CompanyPoint_suspendedAt_idx" ON "CompanyPoint"("suspendedAt");

CREATE TABLE "PointReport" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reporterIpHash" TEXT NOT NULL,
    "reason" "PointReportReason" NOT NULL,
    "comment" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PointReport_pointId_createdAt_idx" ON "PointReport"("pointId", "createdAt");
CREATE INDEX "PointReport_reporterIpHash_pointId_createdAt_idx" ON "PointReport"("reporterIpHash", "pointId", "createdAt");

ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_reporterUserId_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
