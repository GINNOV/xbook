const scheduled = new Set<string>();

/** Tests and explicit opt-out must not spawn a second worker. */
export function workersEnabled() {
  if (process.env.XBOOK_DISABLE_WORKERS === "1") return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return true;
}

function remember(key: string) {
  if (scheduled.has(key)) return false;
  scheduled.add(key);
  return true;
}

export function scheduleEnrichContinuation(origin: string, runId: string, search: string) {
  if (!workersEnabled() || !remember(`enrich:${runId}`)) return false;
  setTimeout(() => {
    scheduled.delete(`enrich:${runId}`);
    void continueEnrich(origin, runId, search);
  }, 200);
  return true;
}

async function continueEnrich(origin: string, runId: string, search: string) {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  params.set("runId", runId);
  const { POST } = await import("@/app/api/enrich/route");
  const request = new Request(`${origin}/api/enrich?${params.toString()}`, { method: "POST" });
  await POST(request).catch((error) => {
    console.error("Enrichment continuation failed:", error);
  });
}

export function scheduleEmbeddingContinuation(origin: string, search: string) {
  const key = `embed:${search}`;
  if (!workersEnabled() || !remember(key)) return false;
  setTimeout(() => {
    scheduled.delete(key);
    void continueEmbedding(origin, search);
  }, 200);
  return true;
}

async function continueEmbedding(origin: string, search: string) {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  params.delete("runId");
  const { POST } = await import("@/app/api/bookmarks/embeddings/sync/route");
  const request = new Request(`${origin}/api/bookmarks/embeddings/sync?${params.toString()}`, { method: "POST" });
  await POST(request).catch((error) => {
    console.error("Embedding continuation failed:", error);
  });
}

export async function resumeInterruptedWork() {
  if (!workersEnabled()) return;
  const { prisma } = await import("@/lib/db");
  const runs = await prisma.operationRun.findMany({
    where: {
      status: { in: ["paused", "queued"] },
      type: { in: ["enrichment_full", "enrichment_full_reprocess", "folder_enrichment", "embedding_sync"] },
    },
    orderBy: { startedAt: "asc" },
    take: 4,
  });
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  for (const run of runs) {
    let search = "";
    try {
      const config = JSON.parse(run.configJson ?? "{}") as { continuationSearch?: unknown };
      if (typeof config.continuationSearch === "string") search = config.continuationSearch;
    } catch {
      search = "";
    }
    if (run.type === "embedding_sync") {
      const source = run.source && run.source !== "system" ? run.source : "";
      scheduleEmbeddingContinuation(origin, search || (source ? `source=${source}` : ""));
      continue;
    }
    if (run.status === "paused") {
      const claimed = await prisma.operationRun.updateMany({
        where: { id: run.id, status: "paused" },
        data: { status: "queued" },
      });
      if (claimed.count !== 1) continue;
    }
    scheduleEnrichContinuation(origin, run.id, search);
  }
}
