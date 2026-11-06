-- Local mirror of the BTC Map (OpenStreetMap) crypto-POI dump, so the navigator
-- no longer depends on the saturated public Overpass API at request time.
CREATE TABLE "OsmCryptoPoi" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "osmId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lon" DOUBLE PRECISION NOT NULL,
  "tags" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsmCryptoPoi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OsmCryptoPoi_lat_lon_idx" ON "OsmCryptoPoi"("lat", "lon");
