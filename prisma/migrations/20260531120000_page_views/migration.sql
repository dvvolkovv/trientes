CREATE TABLE "PageView" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "locale" TEXT,
  "sessionId" TEXT,
  "userId" TEXT,
  "referrer" TEXT,
  "country" TEXT,
  "isBot" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");
CREATE INDEX "PageView_path_createdAt_idx" ON "PageView"("path", "createdAt");
CREATE INDEX "PageView_sessionId_createdAt_idx" ON "PageView"("sessionId", "createdAt");
CREATE INDEX "PageView_country_createdAt_idx" ON "PageView"("country", "createdAt");
