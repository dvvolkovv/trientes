-- Shareable, single-use invite links for company teams.
CREATE TABLE "CompanyInvite" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "role" "CompanyRole" NOT NULL DEFAULT 'VIEWER',
  "token" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedById" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyInvite_token_key" ON "CompanyInvite"("token");
CREATE INDEX "CompanyInvite_companyId_createdAt_idx" ON "CompanyInvite"("companyId", "createdAt");

ALTER TABLE "CompanyInvite"
  ADD CONSTRAINT "CompanyInvite_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyInvite"
  ADD CONSTRAINT "CompanyInvite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyInvite"
  ADD CONSTRAINT "CompanyInvite_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
