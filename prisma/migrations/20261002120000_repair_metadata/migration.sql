ALTER TABLE "Bookmark" ADD COLUMN "embeddingModel" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "embeddingDimensions" INTEGER;
ALTER TABLE "Bookmark" ADD COLUMN "playlistAddedAt" DATETIME;
ALTER TABLE "Bookmark" ADD COLUMN "uploaderChannelId" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "availability" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "captureJson" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "summarySource" TEXT;
