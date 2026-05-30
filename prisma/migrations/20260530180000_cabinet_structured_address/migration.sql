-- Cabinet structured address fields + COMPANY point type.
-- Owner-facing form now collects country/city/street/houseNumber/postalCode separately;
-- existing `address` is kept as a denormalized display string built from the parts.
-- COMPANY type covers online-only companies that still want a map pin at their HQ.

ALTER TYPE "PointType" ADD VALUE IF NOT EXISTS 'COMPANY';

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "street" TEXT,
  ADD COLUMN IF NOT EXISTS "houseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode" TEXT;

ALTER TABLE "CompanyPoint"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "street" TEXT,
  ADD COLUMN IF NOT EXISTS "houseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
