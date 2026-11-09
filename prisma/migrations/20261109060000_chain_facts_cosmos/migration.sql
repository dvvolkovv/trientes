-- Слайс V: вторая семья сетей (Cosmos SDK) в тех же фактах сети.
-- genesisHash перестаёт быть обязательным: у Cosmos идентичность сети — это
-- chain-id, а блок 1 на обрезанных узлах недоступен.
ALTER TABLE "CoinCardChainFacts" ALTER COLUMN "genesisHash" DROP NOT NULL;
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "family" TEXT NOT NULL DEFAULT 'SUBSTRATE';
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "chainId" TEXT;
ALTER TABLE "CoinCardChainFacts" ADD COLUMN "minGasPrice" TEXT;
