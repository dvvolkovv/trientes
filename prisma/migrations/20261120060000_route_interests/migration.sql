-- Интересы человека и два его числа (слайс BK, ТЗ 4.4).
CREATE TYPE "InterestVerdict" AS ENUM ('LIKE', 'DISLIKE');

ALTER TABLE "User" ADD COLUMN "routeCorridorMeters" INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE "User" ADD COLUMN "routeAlertMeters" INTEGER NOT NULL DEFAULT 1500;

CREATE TABLE "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "verdict" "InterestVerdict" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInterest_userId_key_key" ON "UserInterest"("userId", "key");

ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
