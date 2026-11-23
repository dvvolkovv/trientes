-- Слайс CC: рекламный материал публикует модератор, а не продавец.
-- Миграция писана руками и применяется `migrate deploy`: этот чекаут — прод, а
-- `migrate dev` умеет предлагать сброс базы.

ALTER TYPE "CompanyAdStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "CompanyAdStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TYPE "CaseSubjectType" ADD VALUE IF NOT EXISTS 'COMPANY_AD';

ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'APPROVE_COMPANY_AD';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'REJECT_COMPANY_AD';

ALTER TABLE "CompanyAd"
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decidedById" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingPayload" JSONB,
  ADD COLUMN IF NOT EXISTS "pendingAt" TIMESTAMP(3);

-- Автор решения снимается в NULL, а не держит запись от удаления: уборка AU уже
-- упиралась в `AdminAuditLog.actorId` с RESTRICT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyAd_decidedById_fkey'
  ) THEN
    ALTER TABLE "CompanyAd"
      ADD CONSTRAINT "CompanyAd_decidedById_fkey"
      FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
