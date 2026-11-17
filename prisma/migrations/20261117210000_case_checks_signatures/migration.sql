-- Слайс AP — лист проверок, вердикты по документам, правило четырёх глаз.

CREATE TYPE "CaseCheckState" AS ENUM ('TODO', 'OK', 'FAIL', 'NA');
CREATE TYPE "CaseDocumentVerdict" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RESUBMIT');
CREATE TYPE "CaseDecision" AS ENUM ('APPROVED', 'REJECTED');

-- Новые значения в существующем перечислении. Внутри транзакции их добавить
-- можно (PostgreSQL 12+), использовать в той же транзакции — нельзя; мы и не используем.
ALTER TYPE "CaseEventKind" ADD VALUE 'REVIEWED';
ALTER TYPE "CaseEventKind" ADD VALUE 'CHECK_SET';
ALTER TYPE "CaseEventKind" ADD VALUE 'DOCUMENT_VERDICT';

ALTER TABLE "ComplianceCase" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "ComplianceCase" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ComplianceCase" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "ComplianceCase" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "ComplianceCase" ADD COLUMN "soleSignOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ComplianceCase" ADD COLUMN "decision" "CaseDecision";
ALTER TABLE "ComplianceCase" ADD COLUMN "decisionReason" TEXT;

ALTER TABLE "ComplianceCase" ADD CONSTRAINT "ComplianceCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceCase" ADD CONSTRAINT "ComplianceCase_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CaseCheck" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" "CaseCheckState" NOT NULL DEFAULT 'TODO',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaseCheck_caseId_key_key" ON "CaseCheck"("caseId", "key");
CREATE INDEX "CaseCheck_caseId_idx" ON "CaseCheck"("caseId");

ALTER TABLE "CaseCheck" ADD CONSTRAINT "CaseCheck_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseCheck" ADD CONSTRAINT "CaseCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CaseDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "verdict" "CaseDocumentVerdict" NOT NULL DEFAULT 'PENDING',
    "verdictById" TEXT,
    "verdictAt" TIMESTAMP(3),
    "verdictNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaseDocument_caseId_url_key" ON "CaseDocument"("caseId", "url");
CREATE INDEX "CaseDocument_caseId_idx" ON "CaseDocument"("caseId");
CREATE INDEX "CaseDocument_verdictById_verdictAt_idx" ON "CaseDocument"("verdictById", "verdictAt");

ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_verdictById_fkey" FOREIGN KEY ("verdictById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
