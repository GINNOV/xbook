import Link from "next/link";
import FoldersPanel from "@/app/components/FoldersPanel";
import YouTubeFoldersPanel from "@/app/components/YouTubeFoldersPanel";
import { XLogo, YouTubeLogo } from "@/app/components/Icons";
import { prisma } from "@/lib/db";
import { toIsoDate } from "@/lib/folders";
import { fetchYouTubePlaylists } from "@/lib/youtube";
import { getSettings } from "@/lib/settings";
import { localVideoIdentity } from "../lib/folder-links";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FoldersPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const tab = resolvedParams?.tab === "yt" ? "yt" : "x";
  const settings = await getSettings();
  
  const folders = await prisma.bookmarkFolder.findMany({
    where: { id: { not: { startsWith: "yt:pl:" } } },
    include: { _count: { select: { bookmarks: { where: { source: "x" } } } } },
    orderBy: { name: "asc" },
  });
  const [ytFolders, ytBookmarks] = await Promise.all([
    prisma.bookmarkFolder.findMany({ where: { id: { startsWith: "yt:pl:" } }, orderBy: { name: "asc" } }),
    prisma.bookmark.findMany({ where: { source: "yt" }, select: { id: true, tweetUrl: true, folderId: true } }),
  ]);
  const localByFolder = new Map<string, { total: number; videos: Set<string> }>();
  for (const bookmark of ytBookmarks) {
    if (!bookmark.folderId) continue;
    const group = localByFolder.get(bookmark.folderId) ?? { total: 0, videos: new Set<string>() };
    group.total++;
    group.videos.add(localVideoIdentity(bookmark));
    localByFolder.set(bookmark.folderId, group);
  }
  let ytLivePlaylists: Awaited<ReturnType<typeof fetchYouTubePlaylists>> | null = null;
  if (tab === "yt") {
    try { ytLivePlaylists = await fetchYouTubePlaylists(); } catch { /* Local folders remain usable when the provider is unavailable. */ }
  }
  const ytById = new Map<string, { id: string; name: string | null; total: number; uniqueVideos: number; sourceEntries: number | null; lastFetchedAt: string | null; lastProcessedAt: string | null }>(ytFolders.map((folder) => [folder.id, {
    id: folder.id, name: folder.name, total: localByFolder.get(folder.id)?.total ?? 0,
    uniqueVideos: localByFolder.get(folder.id)?.videos.size ?? 0, sourceEntries: null satisfies number | null,
    lastFetchedAt: toIsoDate(folder.lastFetchedAt), lastProcessedAt: toIsoDate(folder.lastProcessedAt),
  }]));
  for (const playlist of ytLivePlaylists ?? []) {
    const id = `yt:pl:${playlist.id}`;
    const local = ytById.get(id);
    ytById.set(id, { id, name: playlist.title ?? local?.name ?? null,
      total: localByFolder.get(id)?.total ?? 0, uniqueVideos: localByFolder.get(id)?.videos.size ?? 0,
      sourceEntries: playlist.itemCount ?? null,
      lastFetchedAt: local?.lastFetchedAt ?? null, lastProcessedAt: local?.lastProcessedAt ?? null });
  }
  const playlistRows = [...ytById.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const localEntries = ytBookmarks.length;
  const uniqueVideos = new Set(ytBookmarks.map(localVideoIdentity)).size;

  return (
    <main className="min-h-screen bg-surface-container-low px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <header>
          <h1 className="font-headline text-5xl font-semibold tracking-tight">
            Folder Management
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-on-surface-variant">
            Sync names, import source entries, summarize local items, or rebuild their search index.
            Imports preserve existing summaries and continue from saved progress within your cap.
          </p>
        </header>

        <nav className="inline-flex w-fit rounded-lg bg-surface-container-high p-1">
          <Link
            href="/folders?tab=x"
            aria-label="X folders"
            title="X folders"
            className={`flex items-center gap-2 rounded-md px-5 py-2 text-sm font-semibold ${
              tab === "x" ? "bg-surface-container-lowest text-on-surface" : "text-on-surface-variant"
            }`}
          >
            <XLogo className="h-3.5 w-3.5" />
            Folders
          </Link>
          <Link
            href="/folders?tab=yt"
            aria-label="YouTube playlists"
            title="YouTube playlists"
            className={`flex items-center gap-2 rounded-md px-5 py-2 text-sm font-semibold ${
              tab === "yt" ? "bg-surface-container-lowest text-on-surface" : "text-on-surface-variant"
            }`}
          >
            <YouTubeLogo className="h-3.5 w-5" />
            Playlists
          </Link>
        </nav>

        <section className="rounded-lg bg-surface-container-lowest p-4">
          {tab === "x" ? (
            <FoldersPanel
              folders={folders.map((folder) => ({
                id: folder.id,
                name: folder.name,
                total: folder._count.bookmarks,
                lastFetchedAt: toIsoDate(folder.lastFetchedAt),
                lastProcessedAt: toIsoDate(folder.lastProcessedAt),
              }))}
              soundOnComplete={settings?.soundOnComplete ?? false}
              soundOnError={settings?.soundOnError ?? false}
            />
          ) : (
            <YouTubeFoldersPanel
              folders={playlistRows}
              localEntries={localEntries}
              uniqueVideos={uniqueVideos}
              soundOnComplete={settings?.soundOnComplete ?? false}
              soundOnError={settings?.soundOnError ?? false}
            />
          )}
        </section>
      </div>
    </main>
  );
}
