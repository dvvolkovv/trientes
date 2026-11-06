-- Собственный листинг монет, слайс A.
-- Миграция строго аддитивная: только CREATE TYPE / CREATE TABLE / CREATE INDEX
-- / ADD CONSTRAINT / ALTER TYPE ADD VALUE.
--
-- Из автогенерированного diff'а СОЗНАТЕЛЬНО вырезан блок давнего дрейфа между
-- папкой миграций и schema.prisma (снятие @unique с Company.ownerUserId, два
-- FK и дефолты массивов FintechCompany). Он не имеет отношения к этой задаче,
-- а удаление Company_ownerUserId_key — потеря гарантии уникальности, которую
-- нельзя протаскивать попутным грузом. Дрейф закрывается отдельной миграцией.

-- CreateEnum
CREATE TYPE "CoinCardSection" AS ENUM ('IDENTITY', 'CONTRACTS', 'TOKENOMICS', 'MARKETS', 'SECURITY', 'TEAM', 'LINKS', 'MARKETING', 'ACCEPTANCE');

-- CreateEnum
CREATE TYPE "CoinCardRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CoinCardTrust" AS ENUM ('UNVERIFIED', 'CONTRACT_VERIFIED', 'PROJECT_CLAIMED', 'FULLY_VERIFIED');

-- CreateEnum
CREATE TYPE "ProvenanceKind" AS ENUM ('SELF_REPORTED', 'VERIFIED_ONCHAIN', 'AGGREGATED', 'ADMIN_SET');

-- CreateEnum
CREATE TYPE "CoinCardVote" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "CoinCardRevisionKind" AS ENUM ('CONTENT', 'POLICY');

-- CreateEnum
CREATE TYPE "CoinCardRevisionStatus" AS ENUM ('DRAFT', 'PENDING_SIGNERS', 'PENDING_ADMIN', 'APPLIED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_COIN_CARD';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_COIN_CARD';
ALTER TYPE "AdminAction" ADD VALUE 'APPLY_COIN_REVISION';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_COIN_REVISION';
ALTER TYPE "AdminAction" ADD VALUE 'FORCE_COIN_REVISION';
ALTER TYPE "AdminAction" ADD VALUE 'DISABLE_COIN_MULTISIG';
ALTER TYPE "AdminAction" ADD VALUE 'TRANSFER_COIN_CARD';

-- CreateTable
CREATE TABLE "CoinCard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coinId" TEXT,
    "companyId" TEXT,
    "stewardUserId" TEXT,
    "trust" "CoinCardTrust" NOT NULL DEFAULT 'UNVERIFIED',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "launchDate" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consensus" TEXT,
    "hashAlgo" TEXT,
    "links" JSONB,
    "tokenomics" JSONB,
    "teamInfo" JSONB,
    "marketing" JSONB,
    "security" JSONB,
    "provenance" JSONB,
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardContract" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "decimals" INTEGER,
    "standard" TEXT,
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "explorerUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CoinCardContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardMarket" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "exchangeId" TEXT,
    "exchangeName" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "tradeUrl" TEXT,
    "chain" TEXT,
    "poolAddress" TEXT,
    "priceUsd" DOUBLE PRECISION,
    "volumeUsd24h" DOUBLE PRECISION,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "CoinCardMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardMember" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CoinCardRole" NOT NULL DEFAULT 'VIEWER',
    "sections" "CoinCardSection"[] DEFAULT ARRAY[]::"CoinCardSection"[],
    "isSigner" BOOLEAN NOT NULL DEFAULT false,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinCardMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardInvite" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "role" "CoinCardRole" NOT NULL DEFAULT 'VIEWER',
    "sections" "CoinCardSection"[] DEFAULT ARRAY[]::"CoinCardSection"[],
    "isSigner" BOOLEAN NOT NULL DEFAULT false,
    "token" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinCardInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardPolicy" (
    "cardId" TEXT NOT NULL,
    "multisig" BOOLEAN NOT NULL DEFAULT false,
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "sections" "CoinCardSection"[] DEFAULT ARRAY[]::"CoinCardSection"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinCardPolicy_pkey" PRIMARY KEY ("cardId")
);

-- CreateTable
CREATE TABLE "CoinCardRevision" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "kind" "CoinCardRevisionKind" NOT NULL DEFAULT 'CONTENT',
    "section" "CoinCardSection",
    "authorId" TEXT NOT NULL,
    "status" "CoinCardRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "highRisk" BOOLEAN NOT NULL DEFAULT false,
    "diff" JSONB NOT NULL,
    "thresholdAt" INTEGER,
    "signerCountAt" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "adminId" TEXT,
    "adminNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinCardRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCardApproval" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "decision" "CoinCardVote" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinCardApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinCard_slug_key" ON "CoinCard"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCard_coinId_key" ON "CoinCard"("coinId");

-- CreateIndex
CREATE INDEX "CoinCard_status_createdAt_idx" ON "CoinCard"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CoinCard_trust_idx" ON "CoinCard"("trust");

-- CreateIndex
CREATE INDEX "CoinCardContract_chain_address_idx" ON "CoinCardContract"("chain", "address");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCardContract_cardId_chain_address_key" ON "CoinCardContract"("cardId", "chain", "address");

-- CreateIndex
CREATE INDEX "CoinCardMarket_cardId_idx" ON "CoinCardMarket"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCardMarket_cardId_kind_exchangeName_pair_key" ON "CoinCardMarket"("cardId", "kind", "exchangeName", "pair");

-- CreateIndex
CREATE INDEX "CoinCardMember_userId_idx" ON "CoinCardMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCardMember_cardId_userId_key" ON "CoinCardMember"("cardId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCardInvite_token_key" ON "CoinCardInvite"("token");

-- CreateIndex
CREATE INDEX "CoinCardInvite_cardId_createdAt_idx" ON "CoinCardInvite"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "CoinCardRevision_cardId_createdAt_idx" ON "CoinCardRevision"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "CoinCardRevision_status_createdAt_idx" ON "CoinCardRevision"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CoinCardApproval_revisionId_idx" ON "CoinCardApproval"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCardApproval_revisionId_memberId_key" ON "CoinCardApproval"("revisionId", "memberId");



-- AddForeignKey
ALTER TABLE "CoinCard" ADD CONSTRAINT "CoinCard_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCard" ADD CONSTRAINT "CoinCard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCard" ADD CONSTRAINT "CoinCard_stewardUserId_fkey" FOREIGN KEY ("stewardUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCard" ADD CONSTRAINT "CoinCard_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardContract" ADD CONSTRAINT "CoinCardContract_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardMarket" ADD CONSTRAINT "CoinCardMarket_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardMember" ADD CONSTRAINT "CoinCardMember_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardMember" ADD CONSTRAINT "CoinCardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardInvite" ADD CONSTRAINT "CoinCardInvite_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardInvite" ADD CONSTRAINT "CoinCardInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardInvite" ADD CONSTRAINT "CoinCardInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardPolicy" ADD CONSTRAINT "CoinCardPolicy_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardRevision" ADD CONSTRAINT "CoinCardRevision_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardRevision" ADD CONSTRAINT "CoinCardRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardApproval" ADD CONSTRAINT "CoinCardApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CoinCardRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCardApproval" ADD CONSTRAINT "CoinCardApproval_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CoinCardMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

