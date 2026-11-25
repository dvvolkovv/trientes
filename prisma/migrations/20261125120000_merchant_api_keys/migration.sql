-- Слайс CL: ключи read-only API предприятия (ТЗ 6.4).
CREATE TABLE "MerchantApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantApiKey_keyHash_key" ON "MerchantApiKey"("keyHash");
CREATE INDEX "MerchantApiKey_companyId_revokedAt_idx" ON "MerchantApiKey"("companyId", "revokedAt");

ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
