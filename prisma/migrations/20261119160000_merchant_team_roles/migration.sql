-- Слайс BE: конструктор ролей предприятия, участки по точкам, журнал действий.
-- Спека: docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md

CREATE TABLE "CompanyTeamRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTeamRole_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyTeamRole_companyId_idx" ON "CompanyTeamRole"("companyId");
CREATE UNIQUE INDEX "CompanyTeamRole_companyId_name_key" ON "CompanyTeamRole"("companyId", "name");

ALTER TABLE "CompanyTeamRole" ADD CONSTRAINT "CompanyTeamRole_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyMember" ADD COLUMN "roleId" TEXT;
CREATE INDEX "CompanyMember_roleId_idx" ON "CompanyMember"("roleId");
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "CompanyTeamRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CompanyMemberPoint" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,

    CONSTRAINT "CompanyMemberPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyMemberPoint_memberId_pointId_key" ON "CompanyMemberPoint"("memberId", "pointId");
CREATE INDEX "CompanyMemberPoint_pointId_idx" ON "CompanyMemberPoint"("pointId");

ALTER TABLE "CompanyMemberPoint" ADD CONSTRAINT "CompanyMemberPoint_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "CompanyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMemberPoint" ADD CONSTRAINT "CompanyMemberPoint_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Журнал только вставляется; автор снимается в SET NULL, иначе удаление учётной
-- записи упрётся в RESTRICT, как это уже случилось с AdminAuditLog в уборке AU.
CREATE TABLE "CompanyActionLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyActionLog_companyId_createdAt_idx" ON "CompanyActionLog"("companyId", "createdAt");

ALTER TABLE "CompanyActionLog" ADD CONSTRAINT "CompanyActionLog_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyActionLog" ADD CONSTRAINT "CompanyActionLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
