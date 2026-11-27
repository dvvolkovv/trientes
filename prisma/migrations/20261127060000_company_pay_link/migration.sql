-- Приём платежей в карточке магазина (слайс CP).
-- Писана руками и применяется `prisma migrate deploy`: этот чекаут — прод, а
-- `migrate dev` умеет предлагать сброс базы.

-- Канал связи записи: смена почты или Telegram замораживает смену ссылки на сутки.
ALTER TABLE "User" ADD COLUMN "contactChangedAt" TIMESTAMP(3);

-- Свежесть входа. У сеанса не было ни времени создания, ни подтверждения личности.
ALTER TABLE "Session" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" ADD COLUMN "reauthAt" TIMESTAMP(3);
-- Срок сеанса постоянный (30 суток), поэтому у прежних строк время создания
-- выводится точно, а не догадкой: иначе каждый живой сеанс после выкладки
-- считался бы «свежим входом» четверть часа.
UPDATE "Session" SET "createdAt" = "expires" - interval '30 days';

CREATE TABLE "CompanyPayLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "title" TEXT,
    "unit" TEXT NOT NULL,
    "coinSymbol" TEXT,
    "amount" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "installedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPayLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyPayLink_companyId_key" ON "CompanyPayLink"("companyId");

CREATE TABLE "CompanyPayLinkPending" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "title" TEXT,
    "unit" TEXT NOT NULL,
    "coinSymbol" TEXT,
    "amount" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifyChannels" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPayLinkPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyPayLinkPending_companyId_key" ON "CompanyPayLinkPending"("companyId");
CREATE INDEX "CompanyPayLinkPending_effectiveAt_idx" ON "CompanyPayLinkPending"("effectiveAt");

CREATE TABLE "CompanyPayLinkChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeLinkId" TEXT,
    "beforeMerchantId" TEXT,
    "afterLinkId" TEXT,
    "afterMerchantId" TEXT,
    "note" TEXT,
    "actorUserId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyPayLinkChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyPayLinkChange_companyId_createdAt_idx" ON "CompanyPayLinkChange"("companyId", "createdAt");

CREATE TABLE "CompanyPayLinkCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyPayLinkCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyPayLinkCode_companyId_userId_createdAt_idx" ON "CompanyPayLinkCode"("companyId", "userId", "createdAt");
CREATE INDEX "CompanyPayLinkCode_expiresAt_idx" ON "CompanyPayLinkCode"("expiresAt");

ALTER TABLE "CompanyPayLink" ADD CONSTRAINT "CompanyPayLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLink" ADD CONSTRAINT "CompanyPayLink_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkPending" ADD CONSTRAINT "CompanyPayLinkPending_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkPending" ADD CONSTRAINT "CompanyPayLinkPending_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkChange" ADD CONSTRAINT "CompanyPayLinkChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkChange" ADD CONSTRAINT "CompanyPayLinkChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkCode" ADD CONSTRAINT "CompanyPayLinkCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPayLinkCode" ADD CONSTRAINT "CompanyPayLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
