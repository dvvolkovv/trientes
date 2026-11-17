-- Слайс AO — переписка по делу и колокольчики.

CREATE TYPE "CaseMessageSide" AS ENUM ('STAFF', 'APPLICANT');
CREATE TYPE "AdminNotificationKind" AS ENUM ('APPLICANT_REPLIED', 'DUE_SOON', 'CASE_OVERDUE', 'APPLICANT_SILENT');

-- Новые значения в существующем перечислении. Внутри транзакции их добавить
-- можно (PostgreSQL 12+), использовать в той же транзакции — нельзя; мы и не используем.
ALTER TYPE "CaseEventKind" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "CaseEventKind" ADD VALUE 'MESSAGE_RECEIVED';

ALTER TABLE "ComplianceCase" ADD COLUMN "firstResponseAt" TIMESTAMP(3);

CREATE TABLE "CaseMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT,
    "side" "CaseMessageSide" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "readByStaffAt" TIMESTAMP(3),
    "readByApplicantAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseMessage_caseId_createdAt_idx" ON "CaseMessage"("caseId", "createdAt");
CREATE INDEX "CaseMessage_side_readByStaffAt_idx" ON "CaseMessage"("side", "readByStaffAt");

ALTER TABLE "CaseMessage" ADD CONSTRAINT "CaseMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseMessage" ADD CONSTRAINT "CaseMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AdminNotificationKind" NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminNotification_userId_readAt_idx" ON "AdminNotification"("userId", "readAt");
CREATE INDEX "AdminNotification_userId_createdAt_idx" ON "AdminNotification"("userId", "createdAt");
CREATE INDEX "AdminNotification_kind_caseId_idx" ON "AdminNotification"("kind", "caseId");

ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
