-- AlterTable
ALTER TABLE "Exchange"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "exchangeType" TEXT,
  ADD COLUMN "currencies" INTEGER,
  ADD COLUMN "pairsCount" INTEGER,
  ADD COLUMN "fiats" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "socials" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'cg';

-- Mark the curated entry distinctly.
UPDATE "Exchange" SET "source" = 'curated' WHERE "id" = 'richamster';

-- CreateIndex
CREATE INDEX "Exchange_source_idx" ON "Exchange"("source");
