-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "description" TEXT,
ADD COLUMN     "explorerUrl" TEXT,
ADD COLUMN     "githubUrl" TEXT,
ADD COLUMN     "metadataFetchedAt" TIMESTAMP(3),
ADD COLUMN     "redditUrl" TEXT,
ADD COLUMN     "twitterUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "whitepaperUrl" TEXT;
