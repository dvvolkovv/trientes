-- Слайс BY: рекламные материалы баннера карточки предприятия и способы оплаты.

CREATE TYPE "CompanyAdKind" AS ENUM ('PROMO', 'EVENT', 'NEWS');
CREATE TYPE "CompanyAdMediaKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "CompanyAdAction" AS ENUM ('NONE', 'PRODUCT', 'WEBSITE', 'POINT');
CREATE TYPE "CompanyAdStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "Company" ADD COLUMN "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "CompanyAd" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CompanyAdKind" NOT NULL DEFAULT 'PROMO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "mediaKind" "CompanyAdMediaKind" NOT NULL DEFAULT 'IMAGE',
    "mediaUrl" TEXT NOT NULL,
    "posterUrl" TEXT,
    "audioUrl" TEXT,
    "promoCode" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "eventAt" TIMESTAMP(3),
    "action" "CompanyAdAction" NOT NULL DEFAULT 'NONE',
    "productId" TEXT,
    "pointId" TEXT,
    "actionUrl" TEXT,
    "status" "CompanyAdStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAd_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyAd_companyId_status_sortOrder_idx" ON "CompanyAd"("companyId", "status", "sortOrder");

ALTER TABLE "CompanyAd" ADD CONSTRAINT "CompanyAd_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyAd" ADD CONSTRAINT "CompanyAd_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyAd" ADD CONSTRAINT "CompanyAd_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyAd" ADD CONSTRAINT "CompanyAd_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
