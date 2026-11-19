-- Слайс BF: задачи команды мерчанта (ТЗ 6.6).
CREATE TYPE "CompanyTaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'ON_REVIEW', 'DONE', 'CANCELLED');
CREATE TYPE "CompanyTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "CompanyTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" "CompanyTaskStatus" NOT NULL DEFAULT 'NEW',
    "priority" "CompanyTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "takenById" TEXT,
    "takenAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "pointId" TEXT,
    "productId" TEXT,
    "warehouseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTaskComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyTask_companyId_status_idx" ON "CompanyTask"("companyId", "status");
CREATE INDEX "CompanyTask_companyId_createdAt_idx" ON "CompanyTask"("companyId", "createdAt");
CREATE INDEX "CompanyTask_assigneeId_status_idx" ON "CompanyTask"("assigneeId", "status");
CREATE INDEX "CompanyTask_pointId_idx" ON "CompanyTask"("pointId");
CREATE INDEX "CompanyTask_dueAt_idx" ON "CompanyTask"("dueAt");
CREATE INDEX "CompanyTaskComment_taskId_createdAt_idx" ON "CompanyTaskComment"("taskId", "createdAt");

ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyTaskComment" ADD CONSTRAINT "CompanyTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompanyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTaskComment" ADD CONSTRAINT "CompanyTaskComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
