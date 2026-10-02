import { NextResponse } from "next/server";
import type { OperationRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { contentSnapshot, saveEnrichmentIfUnchanged } from "@/lib/embedding-index";
import { pendingEnrichmentWhere } from "@/lib/bookmarks";
import { summarizeBookmark, validateModelAvailability } from "@/lib/llm";
import { captureBookmarkSourceEvidence } from "@/lib/source-evidence";
import { enrichmentSignals } from "@/lib/signals";
import {
  createOperationRun,
  logProcessingEvent,
  updateOperationRun,
  incrementOperationRun,
  getActiveRun,
} from "@/lib/processing";
import { MAX_LLM_CONCURRENCY } from "@/lib/llm-limits";
import { buildEnrichmentRunConfig } from "@/lib/run-config";
import { markFolderProcessed } from "@/lib/folders";
import { buildExternalSourceText } from "@/lib/article-extract";
import { allowsConfidentDigest, metadataFromStoredRaw } from "@/lib/youtube-metadata";
import { classifyRunStatus } from "@/lib/run-status";
import { scheduleEnrichContinuation, workersEnabled } from "@/lib/work-continuation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const SAFETY_MARGIN_MS = 20000; // Stop 20s before timeout

function parseExternalUrls(input: string | null) {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildYoutubeFallbackSummary(input: { transcript?: string | null; text?: string | null }) {
  const base = (input.transcript ?? input.text ?? "").replace(/\s+/g, " ").trim();
  if (!base) return null;
  return base.length > 360 ? `${base.slice(0, 357)}...` : base;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit"), concurrencyParam = url.searchParams.get("concurrency");
  const sourceParam = url.searchParams.get("source"), folderIdParam = url.searchParams.get("folderId");
  const runIdParam = url.searchParams.get("runId"), fullParam = url.searchParams.get("full") === "true";
  const reprocessParam = url.searchParams.get("reprocess") === "true";
  const replaceHuman = url.searchParams.get("replace") === "true";
  
  const source = sourceParam === "x" || sourceParam === "yt" ? sourceParam : null;
  const folderId = folderIdParam?.trim() ? folderIdParam.trim() : null;

  if (!runIdParam) {
    const active = await getActiveRun(source);
    if (active) return NextResponse.json({ ok: false, error: `An operation is already running for ${source?.toUpperCase() || "the library"}.` }, { status: 409 });
  }

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const batchLimit = limitParam ? Math.max(1, Number(limitParam)) : (source === "yt" ? 100 : (settings?.enrichBatchSize ?? 50));
  const requestedConcurrency = concurrencyParam
    ? Number(concurrencyParam)
    : (settings?.llmConcurrency ?? 1);
  const concurrency = Math.min(
    MAX_LLM_CONCURRENCY,
    Math.max(1, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 1)
  );

  // Same "pending" definition as the dashboard (empty summary). Force reprocess = whole source.
  const pendingWhere = {
    ...(!reprocessParam ? pendingEnrichmentWhere() : {}),
    ...(!fullParam && !reprocessParam ? { enrichmentFailures: { lt: 3 } } : {}),
    ...(source ? { source } : {}),
    ...(folderId ? { folderId } : {}),
  };

  const attemptedIds = new Set<string>();

  let run: OperationRun | null = null;
  if (runIdParam) {
    run = await prisma.operationRun.findUnique({ where: { id: runIdParam } });
    if (!run) {
      return NextResponse.json(
        { ok: false, error: "Operation run not found.", stopped: true },
        { status: 404 }
      );
    }
    // Do not revive a run the user already stopped/failed — client multi-batch
    // loops used to re-POST with the same runId and flip status back to running.
    if (run.status === "stopped" || run.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          error: `This operation was ${run.status}.`,
          stopped: true,
          runId: run.id,
          remaining: 0,
        },
        { status: 409 }
      );
    }
    await prisma.operationRun.update({ where: { id: run.id }, data: { status: "running" } });
    const pastEvents = await prisma.processingEvent.findMany({
      where: { runId: run.id, bookmarkId: { not: null } },
      select: { bookmarkId: true }
    });
    for (const ev of pastEvents) {
      if (ev.bookmarkId) attemptedIds.add(ev.bookmarkId);
    }
  }

  const sourceLabel = (source ?? "all").toUpperCase();
  let totalInScope = 0;
  let totalBatches = 1;
  let batchIndex = Math.ceil(attemptedIds.size / batchLimit); // 0 when starting fresh

  if (!run) {
    totalInScope = await prisma.bookmark.count({ where: pendingWhere });
    totalBatches = Math.max(1, Math.ceil(totalInScope / batchLimit));
    // "full" means process the whole queue; batchLimit is page size (batch K of N).
    let runType = "enrichment_batch";
    let notes: string;
    if (folderId) {
      runType = "folder_enrichment";
      notes = `${sourceLabel} folder · ${totalInScope} items · batch 0 of ${totalBatches} · concurrency ${concurrency}${reprocessParam ? " · force reprocess" : ""}`;
    } else if (fullParam) {
      runType = reprocessParam ? "enrichment_full_reprocess" : "enrichment_full";
      notes = `${sourceLabel} ${reprocessParam ? "force reprocess all" : "enrich all"} · ${totalInScope} items · batch 0 of ${totalBatches} · concurrency ${concurrency}`;
    } else {
      totalBatches = 1;
      notes = `${sourceLabel} single batch · up to ${batchLimit} of ${totalInScope} pending · concurrency ${concurrency}${reprocessParam ? " · force reprocess" : ""}`;
    }
    run = await createOperationRun({
      type: runType,
      source,
      total: totalInScope,
      notes,
      config: buildEnrichmentRunConfig(settings, {
        concurrency,
        batchSize: batchLimit,
        batchIndex: 0,
        totalBatches,
      }),
    });
  } else {
    totalInScope = run.total || (await prisma.bookmark.count({ where: pendingWhere }));
    totalBatches = Math.max(1, Math.ceil(totalInScope / batchLimit));
    // Refresh batch plan when resuming a multi-request run.
    await updateOperationRun(run.id, {
      configPatch: {
        batchSize: batchLimit,
        totalBatches,
        concurrency,
      },
    });
  }

  if (!run) return NextResponse.json({ ok: false, error: "Failed to initialize operation run" }, { status: 500 });
  const activeRun = run;

  try {
    await validateModelAvailability();
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM pre-flight check failed.";
    await logProcessingEvent({ runId: activeRun.id, type: "system", status: "failed", message: `Enrichment aborted: ${message}` });
    await prisma.operationRun.update({ where: { id: activeRun.id }, data: { status: "failed", finishedAt: new Date(), notes: message } });
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }

  let totalSkipped = 0;
  let totalProcessed = 0, totalUpdated = 0, totalErrors: Array<{ id: string; error: string }> = [];
  let controller = enrichmentSignals.get(activeRun.id);
  if (!controller) { controller = new AbortController(); enrichmentSignals.set(activeRun.id, controller); }
  const signal = controller.signal;

  const modeLabel = folderId
    ? "folder enrich"
    : fullParam
      ? reprocessParam
        ? "force reprocess all"
        : "enrich all"
      : "single batch";

  try {
    while (true) {
      if (Date.now() - startTime > (maxDuration * 1000) - SAFETY_MARGIN_MS) {
        await logProcessingEvent({ runId: activeRun.id, type: "system", status: "skipped", message: "Approaching server timeout. Stopping batch." });
        break;
      }
      if (signal.aborted) break;

      const pendingBatch = await prisma.bookmark.findMany({ where: { ...pendingWhere, id: { notIn: Array.from(attemptedIds) } }, take: batchLimit, orderBy: { importedAt: "desc" }, include: { folder: true } });
      if (pendingBatch.length === 0) break;
      for (const b of pendingBatch) attemptedIds.add(b.id);

      batchIndex += 1;
      await updateOperationRun(activeRun.id, {
        status: "running",
        notes: `${sourceLabel} ${modeLabel} · batch ${batchIndex} of ${totalBatches} · concurrency ${concurrency}`,
        configPatch: {
          batchIndex,
          totalBatches,
          batchSize: batchLimit,
          concurrency,
        },
      });
      await logProcessingEvent({
        runId: activeRun.id,
        type: "system",
        status: "fetching",
        message: `Starting batch ${batchIndex} of ${totalBatches} (${pendingBatch.length} items).`,
      });

      let batchNextIndex = 0, batchUpdated = 0;
      const batchErrors: Array<{ id: string; error: string }> = [];

      async function processBookmark(bookmark: (typeof pendingBatch)[number]) {
        try {
          if (signal.aborted) return;
          await logProcessingEvent({ runId: activeRun.id, bookmarkId: bookmark.id, type: "bookmark", status: "fetching", message: "Preparing bookmark." });
          const isYouTube = bookmark.source === "yt";
          const captured = isYouTube ? await captureBookmarkSourceEvidence(bookmark) : null;
          if (captured) {
            await prisma.bookmark.updateMany({
              where: { id: bookmark.id, rawJson: bookmark.rawJson },
              data: { rawJson: captured.rawJson },
            });
          }
          const transcript = captured?.sourceText ?? null;
          const availability = metadataFromStoredRaw(bookmark.rawJson)?.availability;
          const eligible = allowsConfidentDigest({ availability, transcript });
          if (!eligible.ok) {
            totalSkipped += 1;
            await logProcessingEvent({ runId: activeRun.id, bookmarkId: bookmark.id, type: "bookmark", status: "skipped", message: eligible.reason });
            await incrementOperationRun(activeRun.id, { status: "running", processed: 1, skipped: 1 });
            return;
          }
          const externalUrls = parseExternalUrls(bookmark.externalUrls);
          const article = transcript ? null : await buildExternalSourceText(externalUrls);
          if (article?.captures) {
            await prisma.bookmark.updateMany({
              where: { id: bookmark.id },
              data: { captureJson: JSON.stringify(article.captures) },
            });
          }
          const sourceText = transcript ?? article?.text;
          const enrichmentText = isYouTube ? (sourceText ? undefined : bookmark.text ?? undefined) : bookmark.text ?? undefined;

          if (signal.aborted) return;
          const enrichment = await summarizeBookmark({ text: enrichmentText, folderName: bookmark.folder?.name ?? undefined, authorUsername: bookmark.authorUsername ?? undefined, externalUrls, sourceText, mediaDescription: bookmark.mediaDescription ?? undefined, signal, processing: { runId: activeRun.id, bookmarkId: bookmark.id } });
          const summary = enrichment.summary?.trim() || (isYouTube ? buildYoutubeFallbackSummary({ transcript, text: bookmark.text }) : null);

          const saved = await prisma.$transaction((tx) => saveEnrichmentIfUnchanged(tx, {
            id: bookmark.id,
            snapshot: contentSnapshot(bookmark),
            content: { summary, category: enrichment.category ?? null, tags: enrichment.tags?.length ? enrichment.tags.join(", ") : null },
            embedding: enrichment.embedding,
            replaceHuman,
          }));
          if (!saved) {
            totalSkipped += 1;
            await logProcessingEvent({ runId: activeRun.id, bookmarkId: bookmark.id, type: "bookmark", status: "skipped", message: "Bookmark changed during enrichment; current edits preserved." });
            await incrementOperationRun(activeRun.id, { status: "running", processed: 1, skipped: 1 });
            return;
          }
          batchUpdated += 1;
          await logProcessingEvent({ runId: activeRun.id, bookmarkId: bookmark.id, type: "bookmark", status: "completed", message: "Saved.", metadata: { category: enrichment.category, usedTranscript: !!transcript } });
          await incrementOperationRun(activeRun.id, { status: "running", processed: 1, updated: 1 });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "Unknown error";
          batchErrors.push({ id: bookmark.id, error: errMsg });
          await prisma.bookmark.update({
            where: { id: bookmark.id },
            data: { 
              enrichmentError: errMsg,
              enrichmentFailures: { increment: 1 }
            }
          });
          await logProcessingEvent({ runId: activeRun.id, bookmarkId: bookmark.id, type: "bookmark", status: "failed", message: errMsg });
          await incrementOperationRun(activeRun.id, { status: "running", processed: 1, failed: 1 });
        }
      }

      async function worker() {
        while (true) {
          if (signal.aborted) return;
          if (Date.now() - startTime > (maxDuration * 1000) - SAFETY_MARGIN_MS) return;
          const cur = await prisma.operationRun.findUnique({ where: { id: activeRun.id }, select: { status: true } });
          if (cur?.status === "stopped") return;
          const idx = batchNextIndex; batchNextIndex += 1;
          if (idx >= pendingBatch.length) return;
          await processBookmark(pendingBatch[idx]);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, pendingBatch.length || 1) }, () => worker()));
      const actuallyAttempted = Math.min(batchNextIndex, pendingBatch.length);
      totalProcessed += actuallyAttempted; totalUpdated += batchUpdated; totalErrors = [...totalErrors, ...batchErrors];
      
      if (!fullParam && !folderId) break;
    }
  } finally {
    // Force reprocess matches every row in scope forever — remaining is "not yet
    // attempted in this run", not "still matches pendingWhere".
    const rem = reprocessParam
      ? Math.max(0, totalInScope - attemptedIds.size)
      : await prisma.bookmark.count({ where: pendingWhere });
    const finalStatus = classifyRunStatus({
      cancelled: signal.aborted,
      updated: totalUpdated,
      failed: totalErrors.length,
      remaining: rem,
    });
    const progressNote =
      batchIndex > 0
        ? `${sourceLabel} ${modeLabel} · batch ${batchIndex} of ${totalBatches}`
        : `${sourceLabel} ${modeLabel} · nothing to process`;
    const errNote = totalErrors.length > 0 ? ` · ${totalErrors.length} errors` : "";
    const doneNote = signal.aborted ? " · stopped" : rem === 0 ? " · completed" : " · paused (more remaining)";

    await updateOperationRun(activeRun.id, {
      status: finalStatus,
      notes: `${progressNote}${errNote}${doneNote}`,
      configPatch: {
        batchIndex,
        totalBatches,
        batchSize: batchLimit,
        concurrency,
        continuationSearch: url.search,
      },
      finish: true,
    });
    enrichmentSignals.delete(activeRun.id);
  }

  const remFinal = reprocessParam
    ? Math.max(0, totalInScope - attemptedIds.size)
    : await prisma.bookmark.count({ where: pendingWhere });
  const wasStopped = signal.aborted;
  if (folderId && !wasStopped) {
    await markFolderProcessed(folderId);
  }
  // Client multi-batch loops must keep going while remaining > 0 and this
  // request did real work. "finished" means do not start another request.
  const wholeQueue = fullParam || Boolean(folderId);
  const noMoreWork =
    wasStopped ||
    remFinal === 0 ||
    totalProcessed === 0 ||
    !wholeQueue;
  let continuedByServer = false;
  if (!noMoreWork && workersEnabled()) {
    const claimed = await prisma.operationRun.updateMany({
      where: { id: activeRun.id, status: "paused" },
      data: { status: "queued" },
    });
    if (claimed.count === 1) {
      continuedByServer = scheduleEnrichContinuation(url.origin, activeRun.id, url.search);
    }
  }
  return NextResponse.json({
    ok: true,
    runId: activeRun.id,
    processed: totalProcessed,
    updated: totalUpdated,
    skipped: totalSkipped,
    remaining: remFinal,
    errors: totalErrors,
    finished: noMoreWork || continuedByServer,
    continuedByServer,
    stopped: wasStopped,
    batch: batchIndex,
    batches: totalBatches,
    pageSize: batchLimit,
  });
}
