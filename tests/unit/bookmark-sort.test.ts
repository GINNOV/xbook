import { describe, expect, it } from "vitest";
import {
  parseBookmarkSort,
  prismaBookmarkOrderBy,
  sortBookmarkItems,
} from "@/lib/bookmark-sort";

describe("parseBookmarkSort", () => {
  it("defaults to newest import", () => {
    expect(parseBookmarkSort(undefined, undefined)).toEqual({ sort: "import", dir: "desc" });
  });

  it("ignores unknown sort keys", () => {
    expect(parseBookmarkSort("category", "asc")).toEqual({ sort: "import", dir: "desc" });
  });

  it("uses a column default dir when dir is missing", () => {
    expect(parseBookmarkSort("author", undefined)).toEqual({ sort: "author", dir: "asc" });
    expect(parseBookmarkSort("posted", undefined)).toEqual({ sort: "posted", dir: "desc" });
  });

  it("accepts an explicit dir", () => {
    expect(parseBookmarkSort("summary", "desc")).toEqual({ sort: "summary", dir: "desc" });
  });
});

describe("prismaBookmarkOrderBy", () => {
  it("maps each column to a Prisma orderBy", () => {
    expect(prismaBookmarkOrderBy("summary", "asc")).toEqual({ summary: "asc" });
    expect(prismaBookmarkOrderBy("author", "desc")).toEqual({ authorUsername: "desc" });
    expect(prismaBookmarkOrderBy("folder", "asc")).toEqual({ folder: { name: "asc" } });
    expect(prismaBookmarkOrderBy("posted", "desc")).toEqual({ createdAt: "desc" });
    expect(prismaBookmarkOrderBy("import", "asc")).toEqual({ importedAt: "asc" });
  });
});

describe("sortBookmarkItems", () => {
  const items = [
    { summary: "Beta", authorUsername: "zulu", folderName: "B", createdAt: "2026-01-02", importedAt: "2026-02-01" },
    { summary: "Alpha", authorUsername: "alpha", folderName: "A", createdAt: "2026-01-01", importedAt: "2026-03-01" },
    { summary: null, authorUsername: null, folderName: null, createdAt: null, importedAt: null },
  ];

  it("sorts summaries A–Z and keeps empty last", () => {
    const sorted = sortBookmarkItems(items, "summary", "asc");
    expect(sorted.map((i) => i.summary)).toEqual(["Alpha", "Beta", null]);
  });

  it("sorts authors Z–A", () => {
    const sorted = sortBookmarkItems(items, "author", "desc");
    expect(sorted.map((i) => i.authorUsername)).toEqual(["zulu", "alpha", null]);
  });

  it("sorts import dates newest first", () => {
    const sorted = sortBookmarkItems(items, "import", "desc");
    expect(sorted.map((i) => i.importedAt)).toEqual(["2026-03-01", "2026-02-01", null]);
  });
});
