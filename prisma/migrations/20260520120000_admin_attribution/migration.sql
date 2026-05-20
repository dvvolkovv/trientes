-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "addedByAdminId" TEXT,
ADD COLUMN     "approvedFromRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Coin_approvedFromRequestId_key" ON "Coin"("approvedFromRequestId");

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_addedByAdminId_fkey" FOREIGN KEY ("addedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_approvedFromRequestId_fkey" FOREIGN KEY ("approvedFromRequestId") REFERENCES "CoinRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinRequest" ADD CONSTRAINT "CoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
