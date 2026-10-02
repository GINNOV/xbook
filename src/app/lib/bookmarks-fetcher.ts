import { getBookmarks, getFilterOptions } from "@/lib/bookmarks";
import { normalizeBookmarkPagination } from "@/lib/bookmark-pagination";
import { parseBookmarkSort } from "@/lib/bookmark-sort";

function getParams(p: any) {
  const q = p?.q || ""; const cat = p?.category || ""; const fid = p?.folderId || ""; const src = p?.source || "";
  const st = p?.status || ""; const vid = p?.video === "true"; const sem = p?.semantic === "true";
  const { page: pg } = normalizeBookmarkPagination(p?.page, undefined);
  const { sort, dir } = parseBookmarkSort(p?.sort, p?.dir, sem && Boolean(q));
  const match = p?.match === "word" || p?.match === "phrase" ? p.match : "substring";
  return { q, cat, fid, src, st, vid, sem, pg, sort, dir, match };
}

export async function getBookmarksPageData(p: any, pageSize: number) {
  const par = getParams(p);
  const [filters, data] = await Promise.all([
    getFilterOptions(par.src),
    getBookmarks({ query: par.q, category: par.cat, folderId: par.fid, source: par.src, status: par.st, video: par.vid, semantic: par.sem, page: par.pg, pageSize, sort: par.sort, dir: par.dir, match: par.match })
  ]);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const currentPage = data.page;
  return { ...par, pg: currentPage, filters, data, totalPages, currentPage };
}

export function buildPageHref(p: any) {
  return (n: number) => {
    const params = new URLSearchParams({ ...p, page: String(n) });
    if (n <= 1) params.delete("page");
    return `/bookmarks?${params.toString()}`;
  };
}
