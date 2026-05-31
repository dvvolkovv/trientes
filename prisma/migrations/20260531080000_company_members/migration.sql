CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

CREATE TABLE "CompanyMember" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CompanyRole" NOT NULL DEFAULT 'VIEWER',
  "invitedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");
CREATE INDEX "CompanyMember_userId_idx" ON "CompanyMember"("userId");

ALTER TABLE "CompanyMember"
  ADD CONSTRAINT "CompanyMember_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMember"
  ADD CONSTRAINT "CompanyMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing Company.ownerUserId becomes an OWNER row.
INSERT INTO "CompanyMember" ("id", "companyId", "userId", "role", "createdAt")
SELECT
  'cmbb_' || substring(md5(random()::text || c."id"), 1, 20),
  c."id",
  c."ownerUserId",
  'OWNER',
  c."createdAt"
FROM "Company" c
ON CONFLICT ("companyId", "userId") DO NOTHING;
