import { getIndexHealth } from "@/lib/index-health";
import { getEffectiveEmbeddingIdentity } from "@/lib/llm";
import { prisma } from "@/lib/db";
import {
  blockedEnrichmentWhere,
  failedEnrichmentWhere,
  pendingEnrichmentWhere,
  summarizedEnrichmentWhere,
} from "@/lib/bookmarks";
import { AppSettings, getUsageMonth } from "@/lib/settings";
import { fetchXUsage } from "@/lib/x";

type UsageMonth = Awaited<ReturnType<typeof getUsageMonth>>;
type LiveXUsage = NonNullable<Awaited<ReturnType<typeof fetchXUsage>>>;

export async function getDashboardStats(tab: "x" | "yt") {
  const sourceWhere = { source: tab };
  const [
    total,
    summarized,
    pending,
    failed,
    blocked,
    usage,
    settings,
    lastRun,
    recentRuns,
    indexHealth,
  ] = await Promise.all([
    prisma.bookmark.count({ where: sourceWhere }),
    // Match bookmarks list status filters so summarized + pending = total
    prisma.bookmark.count({ where: { ...sourceWhere, ...summarizedEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...pendingEnrichmentWhere() } }),
    // Current library state — not lifetime operation-run counters
    prisma.bookmark.count({ where: { ...sourceWhere, ...failedEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...blockedEnrichmentWhere() } }),
    getUsageMonth(new Date(), tab),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.operationRun.findFirst({ where: { source: tab, type: { in: ["import_pipeline", "x_sync", "x_folder_import", "youtube_sync", "youtube_playlist_import"] }, processed: { gt: 0 } }, orderBy: { startedAt: "desc" } }),
    prisma.operationRun.findMany({
      where: { source: tab },
      orderBy: { startedAt: "desc" },
      take: 5,
      // First LLM row fills model/host for older runs that lack configJson.
      include: {
        llmRequests: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { model: true, baseUrl: true },
        },
      },
    }),
    getEffectiveEmbeddingIdentity().catch(() => undefined).then((identity) => getIndexHealth(prisma, identity, tab)),
  ]);

  const recent = await prisma.bookmark.findMany({
    where: {
      source: tab,
    },
    include: { folder: true },
    orderBy: { importedAt: "desc" },
    take: 20,
  });

  return {
    total,
    summarized,
    usage,
    settings,
    lastRun,
    pending,
    recent,
    operationRuns: recentRuns,
    /** Bookmarks with a current enrichmentError (not historical run sums). */
    failedItemsCount: failed,
    /** Pending items exhausted of auto-retries (enrichmentFailures ≥ 3). */
    skippedItemsCount: blocked,
    indexHealth: { withEmbedding: indexHealth.usable, unindexed: indexHealth.rebuildIds.length, missing: indexHealth.states.missing.length, stale: indexHealth.staleIds.length, states: indexHealth.states },
  };
}

function mapLiveStats(live: LiveXUsage) {
  const d = live.data;
  const used = Number(d.tweet_count ?? NaN);
  const cap = Number(d.cap_per_month ?? NaN);
  const hasBalance = d.balance != null && d.balance !== "";
  // Only treat the response as live when it has usable usage or prepaid data
  if (hasBalance) {
    return {
      usedCount: Number.isFinite(used) ? used : 0,
      cap: Number.isFinite(cap) && cap > 0 ? cap : 0,
      balance: typeof d.balance === "number" ? d.balance.toFixed(2) : String(d.balance),
      liveXUsage: live,
      costPerCall: d.cost_per_unit ?? null,
      usageSource: "live" as const,
    };
  }
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return null;
  return {
    usedCount: used,
    cap,
    balance: null as string | null,
    liveXUsage: live,
    costPerCall: d.cost_per_unit ?? null,
    usageSource: "live" as const,
  };
}

function localImportStats(tab: "x" | "yt", internalUsage: UsageMonth, settings: AppSettings | null) {
  return {
    usedCount: internalUsage.usedBookmarks,
    cap: tab === "yt" ? (settings?.ytMonthlyCap ?? 100) : (settings?.monthlyCap ?? 100),
    balance: null as string | null,
    liveXUsage: null,
    costPerCall: null as number | null,
    usageSource: "local" as const,
  };
}

export async function getLiveXStats(tab: "x" | "yt", internalUsage: UsageMonth, settings: AppSettings | null) {
  if (tab !== "x") return localImportStats(tab, internalUsage, settings);
  try {
    const live = await fetchXUsage();
    if (live) {
      const mapped = mapLiveStats(live);
      if (mapped) return mapped;
    }
  } catch {
    // Fall through to local import counter
  }
  return localImportStats(tab, internalUsage, settings);
}
