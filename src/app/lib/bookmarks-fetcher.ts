import { getBookmarks, getFilterOptions } from "@/lib/bookmarks";
import { bookmarkQuerySchema, bookmarkQueryInputFromParams, type BookmarkSearchParams } from "@/lib/bookmark-query";

export async function getBookmarksPageData(params: BookmarkSearchParams | undefined, pageSize: number) {
  const query = bookmarkQuerySchema.parse(bookmarkQueryInputFromParams(params, pageSize));
  const [filters, data] = await Promise.all([
    getFilterOptions(query.source),
    getBookmarks(query),
  ]);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const currentPage = data.page;
  return { q: query.query, cat: query.category, fid: query.folderId, src: query.source,
    st: query.status, vid: query.video, sem: data.search.mode === "semantic", textMode: query.textMode,
    sort: data.sort, dir: data.dir, pg: currentPage, filters, data, totalPages, currentPage };
}

export function buildPageHref(input: BookmarkSearchParams = {}) {
  return (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") params.set(key, value);
    }
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    return `/bookmarks?${params.toString()}`;
  };
}
