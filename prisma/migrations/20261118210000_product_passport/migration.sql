-- Паспорт товара мира: слайс BB.
-- Писано руками и применяется `migrate deploy`: чекаут — прод, `migrate dev` умеет
-- предлагать сброс базы.

ALTER TYPE "CaseSubjectType" ADD VALUE IF NOT EXISTS 'PRODUCT_CLAIM';
ALTER TYPE "CaseSubjectType" ADD VALUE IF NOT EXISTS 'PRODUCT_REPORT';

CREATE TYPE "ProductRevisionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "ProductReportReason" AS ENUM ('WRONG_DATA', 'FAKE', 'NOT_MINE', 'ILLEGAL', 'OTHER');

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "gtin" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "manufacturerName" TEXT,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "description" TEXT NOT NULL,
    "usage" TEXT,
    "ingredients" TEXT,
    "attributes" JSONB,
    "photos" JSONB,
    "videoUrl" TEXT,
    "documents" JSONB,
    "createdByCompanyId" TEXT,
    "ownerCompanyId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "suspendedById" TEXT,
    "mergedIntoId" TEXT,
    "tokenChain" TEXT,
    "tokenAsset" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX "Product_gtin_key" ON "Product"("gtin");
CREATE INDEX "Product_category_createdAt_idx" ON "Product"("category", "createdAt");
CREATE INDEX "Product_ownerCompanyId_idx" ON "Product"("ownerCompanyId");
CREATE INDEX "Product_createdByCompanyId_idx" ON "Product"("createdByCompanyId");
CREATE INDEX "Product_suspendedAt_idx" ON "Product"("suspendedAt");
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

ALTER TABLE "Product" ADD CONSTRAINT "Product_createdByCompanyId_fkey" FOREIGN KEY ("createdByCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductEdit" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "field" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "revertOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductEdit_productId_createdAt_idx" ON "ProductEdit"("productId", "createdAt");
CREATE INDEX "ProductEdit_companyId_createdAt_idx" ON "ProductEdit"("companyId", "createdAt");

ALTER TABLE "ProductEdit" ADD CONSTRAINT "ProductEdit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductEdit" ADD CONSTRAINT "ProductEdit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductEdit" ADD CONSTRAINT "ProductEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductClaim" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "documents" JSONB,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductClaim_productId_status_idx" ON "ProductClaim"("productId", "status");
CREATE INDEX "ProductClaim_companyId_createdAt_idx" ON "ProductClaim"("companyId", "createdAt");

ALTER TABLE "ProductClaim" ADD CONSTRAINT "ProductClaim_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClaim" ADD CONSTRAINT "ProductClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClaim" ADD CONSTRAINT "ProductClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClaim" ADD CONSTRAINT "ProductClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductRevision" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "status" "ProductRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductRevision_productId_status_idx" ON "ProductRevision"("productId", "status");
CREATE INDEX "ProductRevision_companyId_createdAt_idx" ON "ProductRevision"("companyId", "createdAt");

ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductReport" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reporterIpHash" TEXT NOT NULL,
    "reason" "ProductReportReason" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductReport_productId_createdAt_idx" ON "ProductReport"("productId", "createdAt");
CREATE INDEX "ProductReport_reporterIpHash_productId_createdAt_idx" ON "ProductReport"("reporterIpHash", "productId", "createdAt");

ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
