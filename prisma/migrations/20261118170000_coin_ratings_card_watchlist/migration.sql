-- Закладка на монету, живущую одной карточкой (у неё нет строки Coin, поэтому
-- Watchlist.coinId ей не подходит), и оценка монеты посетителем.

CREATE TABLE "CardWatchlist" (
    "userId" TEXT NOT NULL,
    "cardSlug" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardWatchlist_pkey" PRIMARY KEY ("userId","cardSlug")
);

CREATE INDEX "CardWatchlist_userId_idx" ON "CardWatchlist"("userId");

ALTER TABLE "CardWatchlist" ADD CONSTRAINT "CardWatchlist_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CardWatchlist" ADD CONSTRAINT "CardWatchlist_cardSlug_fkey"
    FOREIGN KEY ("cardSlug") REFERENCES "CoinCard"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CoinRating" (
    "id" TEXT NOT NULL,
    "coinKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoinRating_userId_coinKey_key" ON "CoinRating"("userId","coinKey");

CREATE INDEX "CoinRating_coinKey_idx" ON "CoinRating"("coinKey");

ALTER TABLE "CoinRating" ADD CONSTRAINT "CoinRating_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
