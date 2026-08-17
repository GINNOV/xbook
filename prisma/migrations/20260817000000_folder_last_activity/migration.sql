-- AlterTable
ALTER TABLE "BookmarkFolder" ADD COLUMN "lastFetchedAt" DATETIME;
ALTER TABLE "BookmarkFolder" ADD COLUMN "lastProcessedAt" DATETIME;

-- Backfill from existing bookmark timestamps (best available history).
UPDATE "BookmarkFolder"
SET "lastFetchedAt" = (
  SELECT MAX("importedAt") FROM "Bookmark" WHERE "Bookmark"."folderId" = "BookmarkFolder"."id"
);

UPDATE "BookmarkFolder"
SET "lastProcessedAt" = (
  SELECT MAX("summarizedAt") FROM "Bookmark" WHERE "Bookmark"."folderId" = "BookmarkFolder"."id"
);
