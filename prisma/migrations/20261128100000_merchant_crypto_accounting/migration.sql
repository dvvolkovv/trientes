-- Слайс CR — криптоучёт мерчанта (ТЗ 6.8).
-- Писана руками и применяется `migrate deploy`: этот чекаут — прод, а `migrate dev`
-- умеет предлагать сброс базы.

-- Крипто-факты чека: куда пришло и чем доказывается. Заявление продавца, как монета и
-- курс в CK; в сети мы их не проверяем.
ALTER TABLE "Sale" ADD COLUMN "payAddress" TEXT;
ALTER TABLE "Sale" ADD COLUMN "payTxHash" TEXT;

CREATE TYPE "CryptoOpKind" AS ENUM ('RECEIPT', 'CONVERSION', 'WITHDRAWAL');

CREATE TABLE "CompanyCryptoAddress" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "label" TEXT,
    "family" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCryptoAddress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCryptoAddress_companyId_address_key" ON "CompanyCryptoAddress"("companyId", "address");
CREATE INDEX "CompanyCryptoAddress_companyId_archivedAt_idx" ON "CompanyCryptoAddress"("companyId", "archivedAt");
CREATE INDEX "CompanyCryptoAddress_addressKey_idx" ON "CompanyCryptoAddress"("addressKey");

ALTER TABLE "CompanyCryptoAddress" ADD CONSTRAINT "CompanyCryptoAddress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyCryptoAddress" ADD CONSTRAINT "CompanyCryptoAddress_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CompanyCryptoOperation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CryptoOpKind" NOT NULL,
    "coin" TEXT NOT NULL,
    "amount" DECIMAL(28,8) NOT NULL,
    "rate" DECIMAL(24,8),
    "currency" TEXT NOT NULL,
    "fiatAmount" DECIMAL(18,2),
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "address" TEXT,
    "txHash" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCryptoOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyCryptoOperation_companyId_happenedAt_idx" ON "CompanyCryptoOperation"("companyId", "happenedAt");
CREATE INDEX "CompanyCryptoOperation_companyId_coin_idx" ON "CompanyCryptoOperation"("companyId", "coin");

ALTER TABLE "CompanyCryptoOperation" ADD CONSTRAINT "CompanyCryptoOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyCryptoOperation" ADD CONSTRAINT "CompanyCryptoOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Санкционный список. Своя таблица, а не Redis: по ней сверяются живые экраны.
CREATE TABLE "SanctionedCryptoAddress" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "listedName" TEXT,
    "programs" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanctionedCryptoAddress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SanctionedCryptoAddress_source_addressKey_key" ON "SanctionedCryptoAddress"("source", "addressKey");
CREATE INDEX "SanctionedCryptoAddress_addressKey_idx" ON "SanctionedCryptoAddress"("addressKey");
