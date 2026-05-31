-- Standard spot maker/taker fees for top exchanges (curated, manually maintained).
ALTER TABLE "Exchange"
  ADD COLUMN "makerFeePercent" DOUBLE PRECISION,
  ADD COLUMN "takerFeePercent" DOUBLE PRECISION,
  ADD COLUMN "feesNote" TEXT,
  ADD COLUMN "feesUrl" TEXT;
