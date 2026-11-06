-- Мягкое удаление компаний и точек приёма + узкая мультиподпись для удаления
-- сотрудником (слайс G2). Миграция строго аддитивная: ADD COLUMN / CREATE TYPE
-- / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ADD VALUE.
--
-- Написана руками: автодифф протащил бы давний дрейф схемы, не относящийся
-- к задаче (см. комментарий в 20261106190000_coin_card/migration.sql).

-- AlterEnum: PostgreSQL ≤11 не умеет два значения за раз, поэтому по одному.
ALTER TYPE "AdminAction" ADD VALUE 'DELETE_COMPANY';
ALTER TYPE "AdminAction" ADD VALUE 'DELETE_POINT';

-- CreateEnum
CREATE TYPE "CompanyDeletionKind" AS ENUM ('COMPANY', 'POINT');
CREATE TYPE "CompanyDeletionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
CREATE TYPE "CompanyDeletionVote" AS ENUM ('APPROVE', 'REJECT');

-- AlterTable: мягкое удаление
ALTER TABLE "Company" ADD COLUMN "deletedAt" TIMESTAMP(3),
                      ADD COLUMN "deletedById" TEXT;
ALTER TABLE "CompanyPoint" ADD COLUMN "deletedAt" TIMESTAMP(3),
                           ADD COLUMN "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "Company_deletedAt_idx" ON "Company"("deletedAt");
CREATE INDEX "CompanyPoint_deletedAt_idx" ON "CompanyPoint"("deletedAt");

-- CreateTable
CREATE TABLE "CompanyDeletionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CompanyDeletionKind" NOT NULL,
    "pointId" TEXT,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT,
    "status" "CompanyDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "thresholdAt" INTEGER NOT NULL,
    "ownerCountAt" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyDeletionApproval" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" "CompanyDeletionVote" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDeletionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyDeletionRequest_companyId_status_idx" ON "CompanyDeletionRequest"("companyId", "status");
CREATE INDEX "CompanyDeletionRequest_status_expiresAt_idx" ON "CompanyDeletionRequest"("status", "expiresAt");
CREATE INDEX "CompanyDeletionRequest_pointId_idx" ON "CompanyDeletionRequest"("pointId");
CREATE UNIQUE INDEX "CompanyDeletionApproval_requestId_userId_key" ON "CompanyDeletionApproval"("requestId", "userId");

-- AddForeignKey
ALTER TABLE "CompanyDeletionRequest" ADD CONSTRAINT "CompanyDeletionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyDeletionRequest" ADD CONSTRAINT "CompanyDeletionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyDeletionApproval" ADD CONSTRAINT "CompanyDeletionApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CompanyDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyDeletionApproval" ADD CONSTRAINT "CompanyDeletionApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
