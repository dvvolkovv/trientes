-- Правка карточки предприятия, ждущая модератора (слайс BM).
-- Витрина держит прежние значения, новые живут здесь до одобрения.

ALTER TYPE "CaseSubjectType" ADD VALUE IF NOT EXISTS 'COMPANY_REVISION';

CREATE TABLE "CompanyRevision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authorId" TEXT,
    "changes" JSONB NOT NULL,
    "documents" JSONB,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyRevision_companyId_status_idx" ON "CompanyRevision"("companyId", "status");
CREATE INDEX "CompanyRevision_status_createdAt_idx" ON "CompanyRevision"("status", "createdAt");

ALTER TABLE "CompanyRevision" ADD CONSTRAINT "CompanyRevision_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyRevision" ADD CONSTRAINT "CompanyRevision_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyRevision" ADD CONSTRAINT "CompanyRevision_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
