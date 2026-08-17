import { getBookmarks, getFilterOptions } from "@/lib/bookmarks";
import { parseBookmarkSort } from "@/lib/bookmark-sort";

function getParams(p: any) {
  const q = p?.q || ""; const cat = p?.category || ""; const fid = p?.folderId || ""; const src = p?.source || "";
  const st = p?.status || ""; const vid = p?.video === "true"; const sem = p?.semantic === "true";
  const pg = Math.max(1, Number(p?.page) || 1);
  const { sort, dir } = parseBookmarkSort(p?.sort, p?.dir);
  return { q, cat, fid, src, st, vid, sem, pg, sort, dir };
}

export async function getBookmarksPageData(p: any, pageSize: number) {
  const par = getParams(p);
  const [filters, data] = await Promise.all([
    getFilterOptions(par.src),
    getBookmarks({ query: par.q, category: par.cat, folderId: par.fid, source: par.src, status: par.st, video: par.vid, semantic: par.sem, page: par.pg, pageSize, sort: par.sort, dir: par.dir })
  ]);
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const currentPage = Math.min(par.pg, totalPages);
  return { ...par, filters, data, totalPages, currentPage };
}

export function buildPageHref(p: any) {
  return (n: number) => {
    const params = new URLSearchParams({ ...p, page: String(n) });
    if (n <= 1) params.delete("page");
    return `/bookmarks?${params.toString()}`;
  };
}
