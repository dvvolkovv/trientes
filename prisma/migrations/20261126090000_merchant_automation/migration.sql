-- Слайс CO: автоматизация мерчанта (ТЗ 6.7) — события, правила «если — то»,
-- срабатывания и исходящие оповещения наружу.

CREATE TABLE "CompanyEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "subject" TEXT,
    "data" JSONB NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyEvent_companyId_createdAt_idx" ON "CompanyEvent"("companyId", "createdAt");
CREATE INDEX "CompanyEvent_createdAt_idx" ON "CompanyEvent"("createdAt");

CREATE TABLE "CompanyRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "firedCount" INTEGER NOT NULL DEFAULT 0,
    "lastFiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyRule_companyId_trigger_enabled_idx" ON "CompanyRule"("companyId", "trigger", "enabled");

CREATE TABLE "CompanyRuleRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventId" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyRuleRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyRuleRun_ruleId_createdAt_idx" ON "CompanyRuleRun"("ruleId", "createdAt");

CREATE TABLE "CompanyWebhook" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretSealed" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CompanyWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyWebhook_companyId_enabled_idx" ON "CompanyWebhook"("companyId", "enabled");

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyRule" ADD CONSTRAINT "CompanyRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyRule" ADD CONSTRAINT "CompanyRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyRuleRun" ADD CONSTRAINT "CompanyRuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CompanyRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyRuleRun" ADD CONSTRAINT "CompanyRuleRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CompanyEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyWebhook" ADD CONSTRAINT "CompanyWebhook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyWebhook" ADD CONSTRAINT "CompanyWebhook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "CompanyWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CompanyEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
