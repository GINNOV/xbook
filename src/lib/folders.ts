import { prisma } from "@/lib/db";

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function markFoldersFetched(folderIds: Iterable<string>, at = new Date()) {
  const ids = [...new Set(Array.from(folderIds).filter(Boolean))];
  if (!ids.length) return;
  await prisma.bookmarkFolder.updateMany({
    where: { id: { in: ids } },
    data: { lastFetchedAt: at },
  });
}

export async function markFolderProcessed(folderId: string | null | undefined, at = new Date()) {
  if (!folderId) return;
  await prisma.bookmarkFolder.updateMany({
    where: { id: folderId },
    data: { lastProcessedAt: at },
  });
}
