export const BOOKMARK_SORT_KEYS = ["summary", "author", "folder", "posted", "import"] as const;

export type BookmarkSortKey = (typeof BOOKMARK_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const DEFAULT_BOOKMARK_SORT: BookmarkSortKey = "import";
export const DEFAULT_BOOKMARK_DIR: SortDir = "desc";

export function isBookmarkSortKey(value: unknown): value is BookmarkSortKey {
  return typeof value === "string" && (BOOKMARK_SORT_KEYS as readonly string[]).includes(value);
}

export function defaultDirForSort(sort: BookmarkSortKey): SortDir {
  return sort === "posted" || sort === "import" ? "desc" : "asc";
}

export function parseBookmarkSort(sort?: string | null, dir?: string | null): {
  sort: BookmarkSortKey;
  dir: SortDir;
} {
  if (!isBookmarkSortKey(sort)) {
    return { sort: DEFAULT_BOOKMARK_SORT, dir: DEFAULT_BOOKMARK_DIR };
  }
  const parsedDir = dir === "asc" || dir === "desc" ? dir : defaultDirForSort(sort);
  return { sort, dir: parsedDir };
}

export function prismaBookmarkOrderBy(sort: BookmarkSortKey, dir: SortDir) {
  switch (sort) {
    case "summary":
      return { summary: dir };
    case "author":
      return { authorUsername: dir };
    case "folder":
      return { folder: { name: dir } };
    case "posted":
      return { createdAt: dir };
    case "import":
      return { importedAt: dir };
  }
}

function compareNullable(a: string | null | undefined, b: string | null | undefined, dir: SortDir) {
  const emptyA = !a;
  const emptyB = !b;
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

export function sortBookmarkItems<
  T extends {
    summary?: string | null;
    authorUsername?: string | null;
    folderName?: string | null;
    createdAt?: string | null;
    importedAt?: string | null;
  },
>(items: T[], sort: BookmarkSortKey, dir: SortDir): T[] {
  const value = (item: T) => {
    switch (sort) {
      case "summary":
        return item.summary ?? "";
      case "author":
        return item.authorUsername ?? "";
      case "folder":
        return item.folderName ?? "";
      case "posted":
        return item.createdAt ?? "";
      case "import":
        return item.importedAt ?? "";
    }
  };
  return [...items].sort((a, b) => compareNullable(value(a), value(b), dir));
}
