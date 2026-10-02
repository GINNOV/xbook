export const BOOKMARK_SORT_KEYS = ["summary", "author", "folder", "posted", "import", "relevance"] as const;

export type BookmarkSortKey = (typeof BOOKMARK_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const DEFAULT_BOOKMARK_SORT: BookmarkSortKey = "import";
export const DEFAULT_BOOKMARK_DIR: SortDir = "desc";

export function isBookmarkSortKey(value: unknown): value is BookmarkSortKey {
  return typeof value === "string" && (BOOKMARK_SORT_KEYS as readonly string[]).includes(value);
}

export function defaultDirForSort(sort: BookmarkSortKey): SortDir {
  return sort === "posted" || sort === "import" || sort === "relevance" ? "desc" : "asc";
}

export function parseBookmarkSort(sort?: string | null, dir?: string | null, semantic = false): {
  sort: BookmarkSortKey;
  dir: SortDir;
} {
  if (!isBookmarkSortKey(sort) || (sort === "relevance" && !semantic)) {
    return { sort: semantic ? "relevance" : DEFAULT_BOOKMARK_SORT, dir: DEFAULT_BOOKMARK_DIR };
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
    case "relevance":
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
    similarity?: number;
    id?: string;
    summary?: string | null;
    authorUsername?: string | null;
    folderName?: string | null;
    createdAt?: string | null;
    importedAt?: string | null;
  },
>(items: T[], sort: BookmarkSortKey, dir: SortDir): T[] {
  if (sort === "relevance") {
    return [...items].sort((a, b) => {
      const comparison = (a.similarity ?? 0) - (b.similarity ?? 0);
      return (dir === "asc" ? comparison : -comparison) || (a.id ?? "").localeCompare(b.id ?? "");
    });
  }
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
