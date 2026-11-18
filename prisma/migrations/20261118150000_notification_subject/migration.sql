-- Звонок про пересмотр доступа — первый, который говорит не о деле, а о
-- человеке: привязать его к caseId нечем, а без привязки «один повод на
-- сотрудника» не отличить от «один повод вообще».
ALTER TABLE "AdminNotification" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;

CREATE INDEX IF NOT EXISTS "AdminNotification_kind_subjectId_idx"
  ON "AdminNotification"("kind", "subjectId");
