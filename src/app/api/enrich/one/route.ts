import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { contentSnapshot, saveEnrichmentIfUnchanged } from "@/lib/embedding-index";
import { summarizeBookmark } from "@/lib/llm";
import { captureBookmarkSourceEvidence } from "@/lib/source-evidence";
import {
  createOperationRun,
  logProcessingEvent,
  updateOperationRun,
} from "@/lib/processing";
import { getSettings } from "@/lib/settings";
import { buildEnrichmentRunConfig } from "@/lib/run-config";
import { buildExternalSourceText } from "@/lib/article-extract";
import { allowsConfidentDigest, metadataFromStoredRaw } from "@/lib/youtube-metadata";

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
  const url = new URL(request.url);
  const bookmarkId = url.searchParams.get("bookmarkId");

  if (!bookmarkId) {
    return NextResponse.json({ ok: false, error: "Missing bookmarkId" }, { status: 400 });
  }

  const bookmark = await prisma.bookmark.findUnique({
    where: { id: bookmarkId },
    include: { folder: true },
  });
  if (!bookmark) {
    return NextResponse.json({ ok: false, error: "Bookmark not found" }, { status: 404 });
  }

  const replaceHuman = url.searchParams.get("replace") === "true";
  const settings = await getSettings();
  const run = await createOperationRun({
    type: "single_reprocess",
    source: bookmark.source,
    total: 1,
    notes: `bookmark:${bookmark.id}`,
    config: buildEnrichmentRunConfig(settings, {
      concurrency: 1,
      batchSize: 1,
      batchIndex: 1,
      totalBatches: 1,
    }),
  });

  try {
    await logProcessingEvent({
      runId: run.id,
      bookmarkId: bookmark.id,
      type: "bookmark",
      status: "fetching",
      message: "Preparing bookmark for reprocess.",
    });
    const externalUrls = parseExternalUrls(bookmark.externalUrls);
    const isYouTube = bookmark.source === "yt";
    const captured = isYouTube ? await captureBookmarkSourceEvidence(bookmark) : null;
    if (captured) {
      await prisma.bookmark.updateMany({
        where: { id: bookmark.id, rawJson: bookmark.rawJson },
        data: { rawJson: captured.rawJson },
      });
    }
    const transcript = captured?.sourceText ?? null;
    const availability = metadataFromStoredRaw(bookmark.rawJson)?.availability ?? bookmark.availability;
    const eligible = allowsConfidentDigest({ availability, transcript });
    if (!eligible.ok) {
      await logProcessingEvent({ runId: run.id, bookmarkId: bookmark.id, type: "bookmark", status: "skipped", message: eligible.reason });
      await updateOperationRun(run.id, { status: "completed", processed: 1, skipped: 1, notes: eligible.reason, finish: true });
      return NextResponse.json({ ok: true, skipped: true, error: eligible.reason, runId: run.id });
    }
    const article = transcript ? undefined : await buildExternalSourceText(externalUrls);
    if (article?.captures) {
      await prisma.bookmark.updateMany({
        where: { id: bookmark.id },
        data: { captureJson: JSON.stringify(article.captures) },
      });
    }
    const sourceText = transcript ?? article?.text;
    const enrichmentText = isYouTube
      ? sourceText
        ? undefined
        : bookmark.text ?? undefined
      : bookmark.text ?? undefined;

    const enrichment = await summarizeBookmark({
      text: enrichmentText,
      folderName: bookmark.folder?.name ?? undefined,
      authorUsername: bookmark.authorUsername ?? undefined,
      externalUrls,
      sourceText,
      mediaDescription: bookmark.mediaDescription ?? undefined,
      processing: { runId: run.id, bookmarkId: bookmark.id },
    });
    const summary =
      enrichment.summary?.trim() ||
      (isYouTube
        ? buildYoutubeFallbackSummary({
            transcript,
            text: bookmark.text,
          })
        : null);

    const saved = await prisma.$transaction((tx) => saveEnrichmentIfUnchanged(tx, {
      id: bookmark.id,
      snapshot: contentSnapshot(bookmark),
      content: { summary, category: enrichment.category ?? null, tags: enrichment.tags?.length ? enrichment.tags.join(", ") : null },
      embedding: enrichment.embedding,
      replaceHuman,
    }));
    if (!saved) {
      await logProcessingEvent({ runId: run.id, bookmarkId: bookmark.id, type: "bookmark", status: "skipped", message: "Bookmark changed during enrichment; current edits preserved." });
      await updateOperationRun(run.id, { status: "completed", processed: 1, skipped: 1, finish: true });
      return NextResponse.json({ ok: false, skipped: true, error: "Bookmark changed during enrichment; current edits preserved.", runId: run.id }, { status: 409 });
    }
    const updated = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } });

    await logProcessingEvent({
      runId: run.id,
      bookmarkId: bookmark.id,
      type: "bookmark",
      status: "completed",
      message: "Bookmark reprocess saved.",
      metadata: { category: enrichment.category, tags: enrichment.tags },
    });
    await updateOperationRun(run.id, {
      status: "completed",
      processed: 1,
      updated: 1,
      finish: true,
    });

    return NextResponse.json({ ok: true, bookmark: updated, runId: run.id });
  } catch (error) {
    await logProcessingEvent({
      runId: run.id,
      bookmarkId: bookmark.id,
      type: "bookmark",
      status: "failed",
      message: error instanceof Error ? error.message : "Enrich failed",
    });
    await updateOperationRun(run.id, {
      status: "failed",
      processed: 1,
      failed: 1,
      notes: error instanceof Error ? error.message : "Enrich failed",
      finish: true,
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Enrich failed" },
      { status: 500 }
    );
  }
}
