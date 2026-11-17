-- Слайс AN — управление делами. Один слой процесса поверх всех типов заявок:
-- статус самого объекта остаётся источником правды для публикации, дело ведёт
-- работу и в конце проставляет этот статус.

CREATE TYPE "CaseSubjectType" AS ENUM ('COIN_CARD', 'COMPANY', 'POINT', 'EXCHANGE', 'FINTECH', 'KYB', 'COIN_REQUEST', 'POINT_REPORT');
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'IN_REVIEW', 'WAITING_APPLICANT', 'READY_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED');
CREATE TYPE "CaseRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "CaseActorSide" AS ENUM ('STAFF', 'APPLICANT', 'SYSTEM');
CREATE TYPE "CaseEventKind" AS ENUM ('OPENED', 'CLAIMED', 'RELEASED', 'STATUS_CHANGED', 'CLOCK_PAUSED', 'CLOCK_RESUMED', 'TIME_ADJUSTED', 'NOTE', 'DECIDED');
CREATE TYPE "CaseTimeSource" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "ComplianceCase" (
    "id" TEXT NOT NULL,
    "subjectType" "CaseSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "risk" "CaseRisk" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "applicantUserId" TEXT,
    "assigneeId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "slaSeconds" INTEGER NOT NULL,
    "clockStoppedAt" TIMESTAMP(3),
    "handledSeconds" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplianceCase_subjectType_subjectId_key" ON "ComplianceCase"("subjectType", "subjectId");
CREATE INDEX "ComplianceCase_status_dueAt_idx" ON "ComplianceCase"("status", "dueAt");
CREATE INDEX "ComplianceCase_assigneeId_status_idx" ON "ComplianceCase"("assigneeId", "status");
CREATE INDEX "ComplianceCase_subjectType_status_idx" ON "ComplianceCase"("subjectType", "status");

ALTER TABLE "ComplianceCase" ADD CONSTRAINT "ComplianceCase_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceCase" ADD CONSTRAINT "ComplianceCase_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Неизменяемый журнал дела: только вставка.
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorSide" "CaseActorSide" NOT NULL DEFAULT 'STAFF',
    "kind" "CaseEventKind" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");

ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Сеанс работы над делом. Время в руках — сумма сеансов, а не разница дат.
CREATE TABLE "CaseTimeEntry" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "source" "CaseTimeSource" NOT NULL DEFAULT 'AUTO',
    "note" TEXT,

    CONSTRAINT "CaseTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseTimeEntry_caseId_startedAt_idx" ON "CaseTimeEntry"("caseId", "startedAt");
CREATE INDEX "CaseTimeEntry_userId_startedAt_idx" ON "CaseTimeEntry"("userId", "startedAt");

ALTER TABLE "CaseTimeEntry" ADD CONSTRAINT "CaseTimeEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseTimeEntry" ADD CONSTRAINT "CaseTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
