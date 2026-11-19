-- Слайс BG: акции магазина и рассылки с антиспамом.

ALTER TABLE "User" ADD COLUMN "notifyPromos" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "PromoDeliveryOutcome" AS ENUM ('TELEGRAM', 'EMAIL', 'WEBPUSH', 'SKIPPED_MUTED', 'SKIPPED_OFF', 'SKIPPED_CAP', 'SKIPPED_NO_CHANNEL');

CREATE TABLE "CompanyFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyFollow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyFollow_userId_companyId_key" ON "CompanyFollow"("userId", "companyId");
CREATE INDEX "CompanyFollow_companyId_muted_idx" ON "CompanyFollow"("companyId", "muted");
ALTER TABLE "CompanyFollow" ADD CONSTRAINT "CompanyFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFollow" ADD CONSTRAINT "CompanyFollow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MerchantPromo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT,
    "pointId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPromo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MerchantPromo_companyId_archivedAt_idx" ON "MerchantPromo"("companyId", "archivedAt");
CREATE INDEX "MerchantPromo_pointId_endsAt_idx" ON "MerchantPromo"("pointId", "endsAt");
CREATE INDEX "MerchantPromo_productId_endsAt_idx" ON "MerchantPromo"("productId", "endsAt");
ALTER TABLE "MerchantPromo" ADD CONSTRAINT "MerchantPromo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantPromo" ADD CONSTRAINT "MerchantPromo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantPromo" ADD CONSTRAINT "MerchantPromo_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PromoSend" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PromoSend_promoId_createdAt_idx" ON "PromoSend"("promoId", "createdAt");
ALTER TABLE "PromoSend" ADD CONSTRAINT "PromoSend_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "MerchantPromo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoSend" ADD CONSTRAINT "PromoSend_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PromoDelivery" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "PromoDeliveryOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PromoDelivery_userId_createdAt_idx" ON "PromoDelivery"("userId", "createdAt");
CREATE INDEX "PromoDelivery_sendId_outcome_idx" ON "PromoDelivery"("sendId", "outcome");
ALTER TABLE "PromoDelivery" ADD CONSTRAINT "PromoDelivery_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "PromoSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoDelivery" ADD CONSTRAINT "PromoDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PromoClick" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoClick_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PromoClick_promoId_createdAt_idx" ON "PromoClick"("promoId", "createdAt");
ALTER TABLE "PromoClick" ADD CONSTRAINT "PromoClick_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "MerchantPromo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoClick" ADD CONSTRAINT "PromoClick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
