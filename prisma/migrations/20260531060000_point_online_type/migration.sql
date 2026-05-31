-- New PointType variant for services that have no physical location.
ALTER TYPE "PointType" ADD VALUE 'ONLINE';

-- Drop NOT NULL on lat/lon so ONLINE points can be persisted without coords.
ALTER TABLE "CompanyPoint" ALTER COLUMN "lat" DROP NOT NULL;
ALTER TABLE "CompanyPoint" ALTER COLUMN "lon" DROP NOT NULL;
