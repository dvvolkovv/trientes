-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "PointType" AS ENUM ('SHOP', 'ATM', 'POS', 'SALES_OFFICE');

-- AlterEnum
ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_POINT';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_POINT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "country" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_ownerUserId_key" ON "Company"("ownerUserId");

CREATE TABLE "CompanyPoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "PointType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "acceptedCoinIds" TEXT[],
    "logoUrl" TEXT,
    "openingHours" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyPoint_status_idx" ON "CompanyPoint"("status");
CREATE INDEX "CompanyPoint_companyId_idx" ON "CompanyPoint"("companyId");
CREATE INDEX "CompanyPoint_lat_lon_idx" ON "CompanyPoint"("lat", "lon");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPoint" ADD CONSTRAINT "CompanyPoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPoint" ADD CONSTRAINT "CompanyPoint_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
