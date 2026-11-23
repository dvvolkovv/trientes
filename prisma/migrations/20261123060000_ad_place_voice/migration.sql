-- Слайс BZ: место материала, конец события, следы нашей озвучки.
ALTER TABLE "CompanyAd"
  ADD COLUMN "eventEndAt" TIMESTAMP(3),
  ADD COLUMN "placeName" TEXT,
  ADD COLUMN "placeAddress" TEXT,
  ADD COLUMN "placeLat" DOUBLE PRECISION,
  ADD COLUMN "placeLon" DOUBLE PRECISION,
  ADD COLUMN "placeAcceptedCoinIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "placeAcceptedCardIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "placePaymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "audioGenerated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "audioVoice" TEXT,
  ADD COLUMN "audioTextHash" TEXT;
