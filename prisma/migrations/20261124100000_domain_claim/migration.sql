-- CreateEnum
CREATE TYPE "ClaimSubjectKind" AS ENUM ('COIN_CARD', 'FINTECH');

-- CreateEnum
CREATE TYPE "DomainClaimStatus" AS ENUM ('NEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DomainProofKind" AS ENUM ('DKIM', 'DMARC_SPF');

-- CreateEnum
CREATE TYPE "DomainMatchKind" AS ENUM ('EXACT', 'PARENT', 'SUBDOMAIN');

-- CreateEnum
CREATE TYPE "DomainClaimEmailSide" AS ENUM ('PROJECT', 'STAFF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_DOMAIN_CLAIM';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_DOMAIN_CLAIM';

-- AlterEnum
ALTER TYPE "AdminNotificationKind" ADD VALUE 'DOMAIN_CLAIM_ENGINEERING';

-- AlterEnum
ALTER TYPE "CaseSubjectType" ADD VALUE 'DOMAIN_CLAIM';

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "RegisteredExchange" DROP CONSTRAINT "RegisteredExchange_ownerUserId_fkey";

-- DropIndex
DROP INDEX "StockMovement_supplyLineId_idx";

-- AlterTable
ALTER TABLE "FintechCompany" ALTER COLUMN "services" DROP DEFAULT,
ALTER COLUMN "supportedCoinIds" DROP DEFAULT,
ALTER COLUMN "supportedFiats" DROP DEFAULT,
ALTER COLUMN "availableIn" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StaffGrant" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DomainClaim" (
    "id" TEXT NOT NULL,
    "provedDomain" TEXT NOT NULL,
    "matchKind" "DomainMatchKind" NOT NULL,
    "proofKind" "DomainProofKind" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "status" "DomainClaimStatus" NOT NULL DEFAULT 'NEW',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "needsEngineeringAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainClaimEmail" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "side" "DomainClaimEmailSide" NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT,
    "authRaw" TEXT,
    "authorId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainClaimEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainClaimTarget" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "subjectKind" "ClaimSubjectKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "subjectDomain" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "owned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainClaimTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainClaimInvite" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "subjectKind" "ClaimSubjectKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainClaimInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainClaim_provedDomain_status_idx" ON "DomainClaim"("provedDomain", "status");

-- CreateIndex
CREATE INDEX "DomainClaim_status_createdAt_idx" ON "DomainClaim"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainClaimEmail_messageId_key" ON "DomainClaimEmail"("messageId");

-- CreateIndex
CREATE INDEX "DomainClaimEmail_claimId_receivedAt_idx" ON "DomainClaimEmail"("claimId", "receivedAt");

-- CreateIndex
CREATE INDEX "DomainClaimTarget_subjectKind_subjectId_idx" ON "DomainClaimTarget"("subjectKind", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainClaimTarget_claimId_subjectKind_subjectId_key" ON "DomainClaimTarget"("claimId", "subjectKind", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainClaimInvite_tokenHash_key" ON "DomainClaimInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "DomainClaimInvite_claimId_idx" ON "DomainClaimInvite"("claimId");

-- CreateIndex
CREATE INDEX "DomainClaimInvite_subjectKind_subjectId_idx" ON "DomainClaimInvite"("subjectKind", "subjectId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredExchange" ADD CONSTRAINT "RegisteredExchange_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaim" ADD CONSTRAINT "DomainClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaimEmail" ADD CONSTRAINT "DomainClaimEmail_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "DomainClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaimEmail" ADD CONSTRAINT "DomainClaimEmail_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaimTarget" ADD CONSTRAINT "DomainClaimTarget_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "DomainClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaimInvite" ADD CONSTRAINT "DomainClaimInvite_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "DomainClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaimInvite" ADD CONSTRAINT "DomainClaimInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

