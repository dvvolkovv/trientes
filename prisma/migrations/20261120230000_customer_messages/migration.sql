-- Слайс BQ — переписка покупателя с магазином.
-- Писана руками и применяется `migrate deploy`: этот чекаут — прод, а `migrate dev`
-- умеет предлагать сброс базы (прецедент AO).

CREATE TYPE "CustomerSide" AS ENUM ('CUSTOMER', 'STORE');

CREATE TABLE "CustomerThread" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "customerReadAt" TIMESTAMP(3),
    "storeReadAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "blockedById" TEXT,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "side" "CustomerSide" NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerThread_companyId_customerUserId_key" ON "CustomerThread"("companyId", "customerUserId");
CREATE INDEX "CustomerThread_companyId_lastMessageAt_idx" ON "CustomerThread"("companyId", "lastMessageAt");
CREATE INDEX "CustomerThread_customerUserId_lastMessageAt_idx" ON "CustomerThread"("customerUserId", "lastMessageAt");
CREATE INDEX "CustomerMessage_threadId_createdAt_idx" ON "CustomerMessage"("threadId", "createdAt");

ALTER TABLE "CustomerThread" ADD CONSTRAINT "CustomerThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerThread" ADD CONSTRAINT "CustomerThread_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMessage" ADD CONSTRAINT "CustomerMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CustomerThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerMessage" ADD CONSTRAINT "CustomerMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
