CREATE TYPE "StaffLevel" AS ENUM ('VIEW', 'HANDLE', 'APPROVE');

CREATE TABLE "StaffMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "duties" TEXT,
  "invitedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accessReviewAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "revokeReason" TEXT,
  CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "queue" TEXT NOT NULL,
  "level" "StaffLevel" NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffGrant_userId_queue_key" ON "StaffGrant"("userId", "queue");
CREATE INDEX "StaffGrant_queue_level_idx" ON "StaffGrant"("queue", "level");
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffInvite" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "identifier" TEXT,
  "title" TEXT,
  "duties" TEXT,
  "grants" JSONB NOT NULL,
  "invitedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");
CREATE INDEX "StaffInvite_invitedById_idx" ON "StaffInvite"("invitedById");
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
