-- Слайс BI: поставщики, заказы, строки заказа, правила автозаказа.
-- Спека docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md

CREATE TYPE "SupplyOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'DECLINED', 'SHIPPED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierCompanyId" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Supplier_companyId_archivedAt_idx" ON "Supplier"("companyId", "archivedAt");
CREATE INDEX "Supplier_supplierCompanyId_idx" ON "Supplier"("supplierCompanyId");

CREATE TABLE "SupplyOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "status" "SupplyOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expectedAt" TIMESTAMP(3),
    "confirmedEta" TIMESTAMP(3),
    "note" TEXT,
    "declineReason" TEXT,
    "cancelReason" TEXT,
    "autoDrafted" BOOLEAN NOT NULL DEFAULT false,
    "docs" JSONB,
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplyOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplyOrder_companyId_status_idx" ON "SupplyOrder"("companyId", "status");
CREATE INDEX "SupplyOrder_supplierId_status_idx" ON "SupplyOrder"("supplierId", "status");
CREATE INDEX "SupplyOrder_createdAt_idx" ON "SupplyOrder"("createdAt");

CREATE TABLE "SupplyOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "receivedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2),
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplyOrderLine_orderId_idx" ON "SupplyOrderLine"("orderId");
CREATE INDEX "SupplyOrderLine_productId_idx" ON "SupplyOrderLine"("productId");

CREATE TABLE "ReorderRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "minQty" DECIMAL(18,3) NOT NULL,
    "targetQty" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReorderRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReorderRule_warehouseId_productId_key" ON "ReorderRule"("warehouseId", "productId");
CREATE INDEX "ReorderRule_companyId_idx" ON "ReorderRule"("companyId");
CREATE INDEX "ReorderRule_supplierId_idx" ON "ReorderRule"("supplierId");

ALTER TABLE "StockMovement" ADD COLUMN "supplyLineId" TEXT;
CREATE INDEX "StockMovement_supplyLineId_idx" ON "StockMovement"("supplyLineId");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyOrderLine" ADD CONSTRAINT "SupplyOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SupplyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyOrderLine" ADD CONSTRAINT "SupplyOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_supplyLineId_fkey" FOREIGN KEY ("supplyLineId") REFERENCES "SupplyOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
