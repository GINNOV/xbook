export function folderLibraryHref(source: "x" | "yt", folderId: string) {
  return `/bookmarks?${new URLSearchParams({ source, folderId })}`;
}

export function localVideoIdentity(bookmark: { id: string; tweetUrl: string }) {
  try {
    const url = new URL(bookmark.tweetUrl);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || bookmark.id;
    if (/(^|\.)youtube\.com$/.test(url.hostname)) return url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] || bookmark.id;
  } catch { /* Legacy records without a valid video URL remain distinct. */ }
  return bookmark.id;
}
