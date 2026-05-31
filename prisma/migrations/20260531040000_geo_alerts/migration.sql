CREATE TABLE "GeoAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyFintech" BOOLEAN NOT NULL DEFAULT true,
  "notifyPoints" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeoAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeoAlert_userId_countryCode_key" ON "GeoAlert"("userId", "countryCode");
CREATE INDEX "GeoAlert_countryCode_enabled_idx" ON "GeoAlert"("countryCode", "enabled");

ALTER TABLE "GeoAlert"
  ADD CONSTRAINT "GeoAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
