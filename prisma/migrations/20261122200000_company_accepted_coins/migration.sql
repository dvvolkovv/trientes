-- Слайс BX: набор монет предприятия. Точка без своего набора наследует его.
ALTER TABLE "Company" ADD COLUMN "acceptedCoinIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "acceptedCardIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
