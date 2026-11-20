-- Слайс BP: общий чат команды мерчанта (ТЗ 6.6).
-- Миграция писана руками и применяется `migrate deploy`: этот чекаут — прод, а
-- `migrate dev` умеет предлагать сброс базы.

CREATE TABLE "CompanyChatMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyChatMessage_companyId_createdAt_idx" ON "CompanyChatMessage"("companyId", "createdAt");

ALTER TABLE "CompanyChatMessage" ADD CONSTRAINT "CompanyChatMessage_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyChatMessage" ADD CONSTRAINT "CompanyChatMessage_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CompanyChatRead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyChatRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyChatRead_companyId_userId_key" ON "CompanyChatRead"("companyId", "userId");
CREATE INDEX "CompanyChatRead_userId_idx" ON "CompanyChatRead"("userId");

ALTER TABLE "CompanyChatRead" ADD CONSTRAINT "CompanyChatRead_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyChatRead" ADD CONSTRAINT "CompanyChatRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
