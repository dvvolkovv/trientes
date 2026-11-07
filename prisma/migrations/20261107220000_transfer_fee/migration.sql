-- Слайс T: комиссия эталонного перевода как факт сети. Три столбца в уже
-- существующей таблице фактов: комиссия читается тем же часовым прогоном, что
-- время блока, и отдельной модели не требует.
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "transferFeePlanck" TEXT;
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "transferFeeTokens" DOUBLE PRECISION;
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "transferFeeError" TEXT;
