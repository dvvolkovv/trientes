-- CreateTable
CREATE TABLE "ExchangeWatchlist" (
    "userId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeWatchlist_pkey" PRIMARY KEY ("userId","exchangeId")
);

-- CreateIndex
CREATE INDEX "ExchangeWatchlist_userId_idx" ON "ExchangeWatchlist"("userId");

-- AddForeignKey
ALTER TABLE "ExchangeWatchlist" ADD CONSTRAINT "ExchangeWatchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeWatchlist" ADD CONSTRAINT "ExchangeWatchlist_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
