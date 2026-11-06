-- Слайс B: автопроверка контрактов через публичные RPC.
-- Строго аддитивно: заявление проекта (name/symbol/decimals) не трогаем,
-- факт сети пишем в отдельные поля, расхождения — в массив mismatches.
ALTER TABLE "CoinCardContract"
  ADD COLUMN "onchainName" TEXT,
  ADD COLUMN "onchainSymbol" TEXT,
  ADD COLUMN "onchainDecimals" INTEGER,
  ADD COLUMN "onchainTotalSupply" TEXT,
  ADD COLUMN "onchainFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mismatches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "checkedAt" TIMESTAMP(3),
  ADD COLUMN "checkError" TEXT;

-- Очередь сверки: кто дольше всех не проверялся, тот идёт первым.
CREATE INDEX "CoinCardContract_checkedAt_idx" ON "CoinCardContract"("checkedAt");
