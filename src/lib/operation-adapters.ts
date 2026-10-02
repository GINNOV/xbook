import { z } from "zod";
import { normalizeEmbeddingEndpoint } from "./embedding-vector";
import { prisma } from "./db";
import { contentSnapshot, saveEmbeddingIfUnchanged, saveEnrichmentIfUnchanged } from "./embedding-index";
import { captureBookmarkSourceEvidence } from "./source-evidence";
import { generateEmbeddingResult, llmConnectionSchema, summarizeBookmark, validateLlmConnection } from "./llm";
import type { JobAdapter, OperationJob } from "./operation-job";

export const operationSettingsSchema = z.object({
  chat: llmConnectionSchema.optional(),
  embedding: z.object({ model: z.string(), endpoint: z.string().url() }).optional(),
  concurrency: z.number().int().min(1).max(32).default(1),
  batchSize: z.number().int().min(1).max(10000).default(50),
});


export function operationAdapter(job: OperationJob): JobAdapter {
  const settings = operationSettingsSchema.parse(job.settings);
  if (job.kind === "embedding") return {
    preflight: async () => { if (!settings.embedding?.model) throw new Error("Missing embedding model. Select an embedding model in AI settings."); },
    execute: async (id, _job, signal) => {
      const bookmark = await prisma.bookmark.findUnique({ where: { id } });
      if (!bookmark?.summary?.trim()) return async () => "skipped";
      const generated = await generateEmbeddingResult(`${bookmark.summary}\n${bookmark.category ?? ""}\n${bookmark.tags ?? ""}`, signal, settings.embedding);
      return async (tx) => await saveEmbeddingIfUnchanged(tx, { id, snapshot: contentSnapshot(bookmark), embedding: Buffer.from(new Float32Array(generated.vector).buffer), identity: generated.identity }) ? "updated" : "skipped";
    },
  };
  return {
    preflight: async (_job, signal) => {
      if (!settings.chat) throw new Error("Missing chat configuration");
      await validateLlmConnection(signal, settings.chat);
    },
    execute: async (id, operation, signal, runId, persistPreparation) => {
      const bookmark = await prisma.bookmark.findUnique({ where: { id }, include: { folder: true } });
      if (!bookmark || (bookmark.editedAt && !operation.scope.replaceEdited)) return async () => "skipped";
      let urls: string[] = [];
      try { const parsed = z.array(z.string()).safeParse(JSON.parse(bookmark.externalUrls ?? "[]")); if (parsed.success) urls = parsed.data; } catch { /* Older malformed provider URLs. */ }
      const sourceSnapshot = { text: bookmark.text, rawJson: bookmark.rawJson, captureJson: bookmark.captureJson,
        source: bookmark.source, tweetUrl: bookmark.tweetUrl, externalUrls: bookmark.externalUrls, mediaDescription: bookmark.mediaDescription };
      const captured = await captureBookmarkSourceEvidence(bookmark, signal);
      const linkedText = captured.sourceText;
      if (persistPreparation && !await persistPreparation(async (tx) => {
        const saved = await tx.bookmark.updateMany({ where: { id, ...sourceSnapshot }, data: { captureJson: captured.captureJson } });
        if (!saved.count) throw new Error("Source changed during capture. Retry using its current content.");
      })) throw new Error("Operation ownership lost during capture");
      if (!captured.eligible) throw new Error(captured.blockedReason ?? "No adequate source evidence was captured.");
      const enrichment = await summarizeBookmark({ text: bookmark.source === "yt" && linkedText ? undefined : bookmark.text ?? undefined,
        authorUsername: bookmark.authorUsername ?? undefined, folderName: bookmark.folder?.name ?? undefined, mediaDescription: bookmark.mediaDescription ?? undefined,
        externalUrls: urls, sourceText: linkedText, sourceSections: captured.sections, sourceCapture: { method: captured.method, language: captured.capture.language ?? null, status: captured.capture.status, reason: captured.capture.reason }, signal, connection: settings.chat, embeddingConnection: settings.embedding, skipEmbedding: Boolean(operation.import?.pipeline), processing: { runId, bookmarkId: id } });
      return async (tx) => {
        const saved = await saveEnrichmentIfUnchanged(tx, { id, snapshot: contentSnapshot(bookmark),
          sourceSnapshot: { ...sourceSnapshot, captureJson: persistPreparation ? captured.captureJson : bookmark.captureJson },
          content: { summary: enrichment.summary, category: enrichment.category ?? null, tags: enrichment.tags?.join(", ") ?? null },
          embedding: enrichment.embedding, embeddingIdentity: enrichment.embeddingIdentity,
          provenance: JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), runId, method: captured.method,
            captureStatus: captured.capture.status, captureReason: captured.capture.reason, model: settings.chat?.model,
            endpoint: settings.chat ? normalizeEmbeddingEndpoint(settings.chat.baseUrl) : null, replacedHumanEdit: Boolean(bookmark.editedAt && operation.scope.replaceEdited) }) });
        if (saved) await tx.bookmark.updateMany({ where: { id, rawJson: bookmark.rawJson }, data: { captureJson: captured.captureJson } });
        return saved ? "updated" : "skipped";
      };
    },
  };
}
