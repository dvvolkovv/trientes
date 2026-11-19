-- Слайс BC: предложение продавца, склады, остатки и движения.
-- Спека docs/superpowers/specs/2026-11-19-product-offers-warehouses-design.md

CREATE TYPE "WarehouseKind" AS ENUM ('WHOLESALE', 'SHELF', 'THIRD_PARTY');
CREATE TYPE "StockMoveKind" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST');
CREATE TYPE "StockMoveStatus" AS ENUM ('IN_TRANSIT', 'DONE', 'CANCELLED');
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL,
    "name" TEXT NOT NULL,
    "pointId" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT,
    "address" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Warehouse_companyId_kind_idx" ON "Warehouse"("companyId", "kind");
CREATE INDEX "Warehouse_pointId_idx" ON "Warehouse"("pointId");
CREATE INDEX "Warehouse_archivedAt_idx" ON "Warehouse"("archivedAt");

CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockBalance_warehouseId_productId_key" ON "StockBalance"("warehouseId", "productId");
CREATE INDEX "StockBalance_productId_idx" ON "StockBalance"("productId");

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "status" "StockMoveStatus" NOT NULL DEFAULT 'DONE',
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "carrierName" TEXT,
    "trackingCode" TEXT,
    "shippedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "note" TEXT,
    "reverseOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_companyId_createdAt_idx" ON "StockMovement"("companyId", "createdAt");
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_status_companyId_idx" ON "StockMovement"("status", "companyId");

CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "cashbackPercent" DECIMAL(5,2),
    "saleRules" TEXT,
    "onlineUrl" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductOffer_companyId_productId_key" ON "ProductOffer"("companyId", "productId");
CREATE INDEX "ProductOffer_productId_status_idx" ON "ProductOffer"("productId", "status");
CREATE INDEX "ProductOffer_companyId_status_idx" ON "ProductOffer"("companyId", "status");

ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
