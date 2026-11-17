-- Надзор над залистованным предприятием (слайс AR).
-- Писано руками: чекаут — прод, а `migrate dev` умеет предлагать сброс базы.

ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_WARNED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_SUSPENDED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_RESTORED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'REVIEW_PASSED';
ALTER TYPE "AdminNotificationKind" ADD VALUE IF NOT EXISTS 'REVIEW_DUE';

-- Снятие с витрины: статус APPROVED не трогаем.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendReason" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendedById" TEXT;
CREATE INDEX IF NOT EXISTS "Company_suspendedAt_idx" ON "Company"("suspendedAt");

-- Срок следующего пересмотра живёт в деле компании, а не в отдельном деле:
-- у дела @@unique(subjectType, subjectId), второго дела у объекта быть не может.
ALTER TABLE "ComplianceCase" ADD COLUMN IF NOT EXISTS "nextReviewAt" TIMESTAMP(3);
